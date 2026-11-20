/**
 * @mcp/server - Built-in Middleware
 * Authentication, rate limiting, logging, tracing, metrics, validation, caching, circuit breaker
 */

import { ServerMiddleware, RequestContext, ResponseContext, ErrorContext, ConnectionContext } from './server';
import { MCPMessage, MCPError, ERROR_CODES } from '@mcp/types';
import { createHash, randomBytes } from 'crypto';

// ============================================================================
// Authentication Middleware
// ============================================================================

export interface AuthConfig {
  // API Key authentication
  apiKeys?: Map<string, { tenantId?: string; scopes?: string[] }>;

  // JWT/OIDC
  jwt?: {
    issuer: string;
    audience: string | string[];
    jwksUri?: string;
    publicKey?: string;
  };

  // mTLS
  mtls?: {
    caCert: string;
    allowedCNs?: string[];
  };

  // Custom validator
  customValidator?: (token: string, ctx: RequestContext) => Promise<AuthResult | null>;
}

export interface AuthResult {
  principal: string;
  tenantId?: string;
  scopes: string[];
  metadata: Record<string, unknown>;
}

export function auth(config: AuthConfig): ServerMiddleware {
  const apiKeys = config.apiKeys || new Map();

  return {
    async onConnect(ctx: ConnectionContext) {
      // Connection-level auth (for transports that support it)
      const authHeader = ctx.metadata['authorization'] as string;
      if (authHeader) {
        const result = await validateAuth(authHeader, ctx);
        if (result) {
          ctx.metadata['auth'] = result;
        }
      }
    },

    async onRequest(ctx: RequestContext, next) {
      // Skip auth for initialize and notifications
      if (ctx.method === 'initialize' || !ctx.message.id) {
        return next();
      }

      const authHeader = ctx.message.params && typeof ctx.message.params === 'object'
        ? (ctx.message.params as any).authorization
        : undefined;

      // Also check connection metadata
      const connAuth = ctx.transport.getConnectionContext?.()?.metadata['auth'] as AuthResult;

      let result: AuthResult | null = connAuth || null;

      if (!result && authHeader) {
        result = await validateAuth(authHeader, ctx);
      }

      if (!result && config.customValidator) {
        const token = extractToken(authHeader);
        if (token) {
          result = await config.customValidator(token, ctx);
        }
      }

      if (!result) {
        throw createMCPError(ctx.requestId, ERROR_CODES.UNAUTHORIZED, 'Authentication required');
      }

      // Add auth info to context
      (ctx as any).auth = result;

      return next();
    },
  };
}

async function validateAuth(authHeader: string, ctx: RequestContext): Promise<AuthResult | null> {
  const token = extractToken(authHeader);
  if (!token) return null;

  // API Key validation
  if (token.startsWith('mcp_')) {
    // In real implementation, check against stored keys
    return {
      principal: `apikey:${token.slice(0, 8)}...`,
      scopes: ['tools:call', 'resources:read'],
      metadata: {},
    };
  }

  // JWT validation (simplified)
  if (token.includes('.')) {
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
      return {
        principal: payload.sub || 'unknown',
        tenantId: payload.tenant_id,
        scopes: payload.scopes || [],
        metadata: payload,
      };
    } catch {
      return null;
    }
  }

  return null;
}

function extractToken(authHeader: string): string | null {
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  if (authHeader.startsWith('ApiKey ')) {
    return authHeader.slice(7);
  }
  return authHeader;
}

function createMCPError(id: any, code: number, message: string): MCPError {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message },
  };
}

// ============================================================================
// Rate Limiting Middleware
// ============================================================================

export interface RateLimitConfig {
  // Requests per window
  windowMs: number;
  maxRequests: number;

  // Key function (default: principal + method)
  keyGenerator?: (ctx: RequestContext) => string;

  // Skip successful requests from count
  skipSuccessfulRequests?: boolean;

  // Skip failed requests from count
  skipFailedRequests?: boolean;

  // Custom handler for rate limited requests
  handler?: (ctx: RequestContext) => MCPError;

  // Store (default: in-memory)
  store?: RateLimitStore;
}

export interface RateLimitStore {
  increment(key: string, windowMs: number): Promise<{ count: number; resetTime: number }>;
  decrement(key: string): Promise<void>;
  reset(key: string): Promise<void>;
}

class MemoryRateLimitStore implements RateLimitStore {
  private counters = new Map<string, { count: number; resetTime: number; timer?: NodeJS.Timeout }>();

  async increment(key: string, windowMs: number): Promise<{ count: number; resetTime: number }> {
    const now = Date.now();
    let entry = this.counters.get(key);

    if (!entry || entry.resetTime < now) {
      entry = { count: 0, resetTime: now + windowMs };
      this.counters.set(key, entry);

      // Auto-cleanup
      entry.timer = setTimeout(() => {
        this.counters.delete(key);
      }, windowMs + 1000);
    }

    entry.count++;
    return { count: entry.count, resetTime: entry.resetTime };
  }

  async decrement(key: string): Promise<void> {
    const entry = this.counters.get(key);
    if (entry) entry.count = Math.max(0, entry.count - 1);
  }

  async reset(key: string): Promise<void> {
    const entry = this.counters.get(key);
    if (entry?.timer) clearTimeout(entry.timer);
    this.counters.delete(key);
  }
}

export function rateLimit(config: RateLimitConfig): ServerMiddleware {
  const store = config.store || new MemoryRateLimitStore();
  const keyGenerator = config.keyGenerator || defaultKeyGenerator;

  return {
    async onRequest(ctx: RequestContext, next) {
      // Skip for initialize
      if (ctx.method === 'initialize') {
        return next();
      }

      const key = keyGenerator(ctx);
      const { count, resetTime } = await store.increment(key, config.windowMs);

      // Add rate limit headers to response context
      (ctx as any).rateLimit = { limit: config.maxRequests, remaining: Math.max(0, config.maxRequests - count), reset: resetTime };

      if (count > config.maxRequests) {
        if (config.handler) {
          throw config.handler(ctx);
        }
        throw createMCPError(
          ctx.requestId,
          ERROR_CODES.RATE_LIMITED,
          `Rate limit exceeded. Try again after ${Math.ceil((resetTime - Date.now()) / 1000)}s`
        );
      }

      return next();
    },

    async onResponse(ctx: ResponseContext, next) {
      // Optionally decrement on success
      if (config.skipSuccessfulRequests && !ctx.response.error) {
        const key = keyGenerator(ctx.request);
        await store.decrement(key);
      }
      return next();
    },

    async onError(ctx: ErrorContext, error: Error, next) {
      // Optionally decrement on error
      if (config.skipFailedRequests && ctx.response?.error) {
        const key = keyGenerator(ctx.request);
        await store.decrement(key);
      }
      return next();
    },
  };
}

function defaultKeyGenerator(ctx: RequestContext): string {
  const auth = (ctx as any).auth as AuthResult;
  const principal = auth?.principal || ctx.transport.getConnectionContext?.()?.connectionId || 'anonymous';
  return `ratelimit:${principal}:${ctx.method}`;
}

// ============================================================================
// Logging Middleware
// ============================================================================

export interface LoggingConfig {
  level?: 'debug' | 'info' | 'warn' | 'error';
  includeRequestBody?: boolean;
  includeResponseBody?: boolean;
  logger?: (level: string, message: string, meta: Record<string, unknown>) => void;
}

export function logging(config: LoggingConfig = {}): ServerMiddleware {
  const logger = config.logger || defaultLogger;
  const level = config.level || 'info';

  return {
    async onRequest(ctx: RequestContext, next) {
      const startTime = Date.now();
      (ctx as any)._logStartTime = startTime;

      logger(level, 'MCP Request', {
        requestId: ctx.requestId,
        method: ctx.method,
        params: config.includeRequestBody ? ctx.params : undefined,
        clientId: ctx.transport.getConnectionContext?.()?.connectionId,
      });

      return next();
    },

    async onResponse(ctx: ResponseContext, next) {
      const duration = Date.now() - ((ctx as any)._logStartTime || Date.now());

      logger(level, 'MCP Response', {
        requestId: ctx.request.requestId,
        method: ctx.request.method,
        durationMs: duration,
        status: ctx.response.error ? 'error' : 'success',
        error: ctx.response.error?.message,
        result: config.includeResponseBody ? ctx.response.result : undefined,
      });

      return next();
    },

    async onError(ctx: ErrorContext, error: Error, next) {
      const duration = Date.now() - ((ctx.request as any)._logStartTime || Date.now());

      logger('error', 'MCP Error', {
        requestId: ctx.request.requestId,
        method: ctx.request.method,
        durationMs: duration,
        error: error.message,
        stack: error.stack,
      });

      return next();
    },

    async onConnect(ctx: ConnectionContext) {
      logger('info', 'MCP Connection Opened', {
        connectionId: ctx.connectionId,
        transport: ctx.transport.constructor.name,
      });
    },

    async onDisconnect(ctx: ConnectionContext, error?: Error) {
      logger('info', 'MCP Connection Closed', {
        connectionId: ctx.connectionId,
        error: error?.message,
      });
    },
  };
}

function defaultLogger(level: string, message: string, meta: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  console[level as keyof Console](JSON.stringify({ timestamp, level, message, ...meta }));
}

// ============================================================================
// Tracing Middleware (OpenTelemetry)
// ============================================================================

export interface TracingConfig {
  serviceName: string;
  tracer?: any; // OpenTelemetry Tracer
  propagators?: any[]; // OpenTelemetry Propagators
}

export function tracing(config: TracingConfig): ServerMiddleware {
  // In a real implementation, this would use @opentelemetry/api
  // For now, we'll add trace context to requests

  return {
    async onRequest(ctx: RequestContext, next) {
      // Extract trace context from incoming request
      const traceParent = ctx.message.params && typeof ctx.message.params === 'object'
        ? (ctx.message.params as any).traceparent
        : undefined;

      if (traceParent) {
        (ctx as any).traceContext = traceParent;
      }

      // Create span
      const spanName = `mcp.${ctx.method}`;
      (ctx as any).span = { name: spanName, startTime: Date.now() };

      return next();
    },

    async onResponse(ctx: ResponseContext, next) {
      const span = (ctx.request as any).span;
      if (span) {
        span.duration = Date.now() - span.startTime;
        span.status = ctx.response.error ? 'error' : 'ok';
        // In real impl: span.end()
      }
      return next();
    },

    async onError(ctx: ErrorContext, error: Error, next) {
      const span = (ctx.request as any).span;
      if (span) {
        span.duration = Date.now() - span.startTime;
        span.status = 'error';
        span.error = error.message;
      }
      return next();
    },
  };
}

// ============================================================================
// Metrics Middleware (Prometheus)
// ============================================================================

export interface MetricsConfig {
  prefix?: string;
  buckets?: number[];
  labels?: Record<string, string>;
}

export function metrics(config: MetricsConfig = {}): ServerMiddleware {
  const prefix = config.prefix || 'mcp';
  const requestCount = new Map<string, number>();
  const requestDuration = new Map<string, number[]>();
  const activeConnections = new Map<string, number>();

  return {
    async onRequest(ctx: RequestContext, next) {
      const key = `${prefix}_requests_total{method="${ctx.method}"}`;
      requestCount.set(key, (requestCount.get(key) || 0) + 1);

      (ctx as any)._metricsStartTime = Date.now();
      return next();
    },

    async onResponse(ctx: ResponseContext, next) {
      const duration = Date.now() - ((ctx.request as any)._metricsStartTime || Date.now());
      const method = ctx.request.method;
      const status = ctx.response.error ? 'error' : 'success';

      const durationKey = `${prefix}_request_duration_seconds{method="${method}",status="${status}"}`;
      const durations = requestDuration.get(durationKey) || [];
      durations.push(duration / 1000);
      if (durations.length > 1000) durations.shift(); // Keep last 1000
      requestDuration.set(durationKey, durations);

      return next();
    },

    async onConnect(ctx: ConnectionContext) {
      const key = `${prefix}_active_connections{transport="${ctx.transport.constructor.name}"}`;
      activeConnections.set(key, (activeConnections.get(key) || 0) + 1);
    },

    async onDisconnect(ctx: ConnectionContext) {
      const key = `${prefix}_active_connections{transport="${ctx.transport.constructor.name}"}`;
      activeConnections.set(key, Math.max(0, (activeConnections.get(key) || 1) - 1));
    },

    // Expose metrics for Prometheus scraping
    getMetrics(): string {
      let output = '';

      for (const [key, value] of requestCount) {
        output += `${key} ${value}\n`;
      }

      for (const [key, durations] of requestDuration) {
        if (durations.length === 0) continue;
        const sum = durations.reduce((a, b) => a + b, 0);
        const avg = sum / durations.length;
        const sorted = [...durations].sort((a, b) => a - b);
        const p50 = sorted[Math.floor(sorted.length * 0.5)];
        const p95 = sorted[Math.floor(sorted.length * 0.95)];
        const p99 = sorted[Math.floor(sorted.length * 0.99)];

        output += `${key}_sum ${sum}\n`;
        output += `${key}_count ${durations.length}\n`;
        output += `${key}_avg ${avg}\n`;
        output += `${key}_p50 ${p50}\n`;
        output += `${key}_p95 ${p95}\n`;
        output += `${key}_p99 ${p99}\n`;
      }

      for (const [key, value] of activeConnections) {
        output += `${key} ${value}\n`;
      }

      return output;
    },
  };
}

// ============================================================================
// Validation Middleware
// ============================================================================

export interface ValidationConfig {
  // Validate tool arguments against inputSchema
  validateTools?: boolean;
  // Validate resource URIs
  validateResources?: boolean;
  // Validate prompt arguments
  validatePrompts?: boolean;
  // Custom validators
  customValidators?: Map<string, (params: any) => Promise<ValidationResult>>;
}

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

export function validation(config: ValidationConfig = {}): ServerMiddleware {
  return {
    async onRequest(ctx: RequestContext, next) {
      if (!ctx.message.params) return next();

      const params = ctx.message.params as Record<string, any>;

      // Validate tool calls
      if (config.validateTools && ctx.method === 'tools/call') {
        const toolName = params.name;
        const args = params.arguments;
        if (toolName && config.customValidators?.has(`tool:${toolName}`)) {
          const validator = config.customValidators!.get(`tool:${toolName}`)!;
          const result = await validator(args);
          if (!result.valid) {
            throw createMCPError(ctx.requestId, ERROR_CODES.INVALID_PARAMS, result.errors?.join(', '));
          }
        }
      }

      // Validate resource reads
      if (config.validateResources && ctx.method === 'resources/read') {
        const uri = params.uri;
        if (uri && config.customValidators?.has(`resource:${uri}`)) {
          const validator = config.customValidators!.get(`resource:${uri}`)!;
          const result = await validator({ uri });
          if (!result.valid) {
            throw createMCPError(ctx.requestId, ERROR_CODES.INVALID_PARAMS, result.errors?.join(', '));
          }
        }
      }

      // Validate prompts
      if (config.validatePrompts && ctx.method === 'prompts/get') {
        const promptName = params.name;
        const args = params.arguments;
        if (promptName && config.customValidators?.has(`prompt:${promptName}`)) {
          const validator = config.customValidators!.get(`prompt:${promptName}`)!;
          const result = await validator(args);
          if (!result.valid) {
            throw createMCPError(ctx.requestId, ERROR_CODES.INVALID_PARAMS, result.errors?.join(', '));
          }
        }
      }

      return next();
    },
  };
}

// ============================================================================
// Caching Middleware
// ============================================================================

export interface CacheConfig {
  // TTL in milliseconds
  ttl: number;

  // Methods to cache (default: resources/read, prompts/get)
  cacheableMethods?: string[];

  // Key generator
  keyGenerator?: (ctx: RequestContext) => string;

  // Cache store
  store?: CacheStore;

  // Skip caching for errors
  skipErrors?: boolean;
}

export interface CacheStore {
  get(key: string): Promise<any | null>;
  set(key: string, value: any, ttl: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

class MemoryCacheStore implements CacheStore {
  private cache = new Map<string, { value: any; expiry: number }>();

  async get(key: string): Promise<any | null> {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (entry.expiry < Date.now()) {
      this.cache.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: any, ttl: number): Promise<void> {
    this.cache.set(key, { value, expiry: Date.now() + ttl });
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
  }

  async clear(): Promise<void> {
    this.cache.clear();
  }
}

export function caching(config: CacheConfig): ServerMiddleware {
  const store = config.store || new MemoryCacheStore();
  const cacheableMethods = config.cacheableMethods || ['resources/read', 'prompts/get'];
  const keyGenerator = config.keyGenerator || defaultCacheKeyGenerator;

  return {
    async onRequest(ctx: RequestContext, next) {
      if (!cacheableMethods.includes(ctx.method)) {
        return next();
      }

      const key = keyGenerator(ctx);
      const cached = await store.get(key);

      if (cached) {
        // Return cached response directly
        ctx.response = {
          jsonrpc: '2.0',
          id: ctx.requestId,
          result: cached,
        } as MCPMessage;
        return; // Skip next()
      }

      (ctx as any)._cacheKey = key;
      return next();
    },

    async onResponse(ctx: ResponseContext, next) {
      const key = (ctx.request as any)._cacheKey;
      if (key && ctx.response.result && (!config.skipErrors || !ctx.response.error)) {
        await store.set(key, ctx.response.result, config.ttl);
      }
      return next();
    },
  };
}

function defaultCacheKeyGenerator(ctx: RequestContext): string {
  const params = ctx.params ? JSON.stringify(ctx.params) : '';
  const hash = createHash('sha256').update(`${ctx.method}:${params}`).digest('hex').slice(0, 16);
  return `cache:${ctx.method}:${hash}`;
}

// ============================================================================
// Circuit Breaker Middleware
// ============================================================================

export interface CircuitBreakerConfig {
  // Failure threshold to open circuit
  threshold?: number;
  // Timeout before trying again (ms)
  timeout?: number;
  // Number of successful requests to close circuit
  resetTimeout?: number;
  // Methods to protect
  methods?: string[];
  // Custom failure detector
  isFailure?: (error: Error) => boolean;
}

export function circuitBreaker(config: CircuitBreakerConfig = {}): ServerMiddleware {
  const threshold = config.threshold || 5;
  const timeout = config.timeout || 30000;
  const resetTimeout = config.resetTimeout || 10000;
  const methods = config.methods || ['tools/call', 'resources/read', 'prompts/get'];
  const isFailure = config.isFailure || (() => true);

  const state = new Map<string, {
    failures: number;
    lastFailure: number;
    status: 'closed' | 'open' | 'half-open';
    successes: number;
  }>();

  return {
    async onRequest(ctx: RequestContext, next) {
      if (!methods.includes(ctx.method)) {
        return next();
      }

      const key = `circuit:${ctx.method}`;
      let circuit = state.get(key);

      if (!circuit) {
        circuit = { failures: 0, lastFailure: 0, status: 'closed', successes: 0 };
        state.set(key, circuit);
      }

      if (circuit.status === 'open') {
        if (Date.now() - circuit.lastFailure > timeout) {
          circuit.status = 'half-open';
        } else {
          throw createMCPError(ctx.requestId, ERROR_CODES.SERVICE_UNAVAILABLE, 'Circuit breaker open');
        }
      }

      return next();
    },

    async onResponse(ctx: ResponseContext, next) {
      const key = `circuit:${ctx.request.method}`;
      const circuit = state.get(key);
      if (!circuit) return next();

      if (ctx.response.error) {
        circuit.failures++;
        circuit.lastFailure = Date.now();
        circuit.successes = 0;

        if (circuit.failures >= threshold) {
          circuit.status = 'open';
        }
      } else if (circuit.status === 'half-open') {
        circuit.successes++;
        if (circuit.successes >= 2) { // 2 successes to close
          circuit.status = 'closed';
          circuit.failures = 0;
        }
      } else {
        circuit.failures = 0;
      }

      return next();
    },

    async onError(ctx: ErrorContext, error: Error, next) {
      const key = `circuit:${ctx.request.method}`;
      const circuit = state.get(key);
      if (!circuit) return next();

      if (isFailure(error)) {
        circuit.failures++;
        circuit.lastFailure = Date.now();
        circuit.successes = 0;

        if (circuit.failures >= threshold) {
          circuit.status = 'open';
        }
      }

      return next();
    },
  };
}

// ============================================================================
// Compression Middleware
// ============================================================================

export interface CompressionConfig {
  threshold?: number; // Minimum response size to compress (bytes)
  level?: number; // Compression level (1-9)
}

export function compression(config: CompressionConfig = {}): ServerMiddleware {
  const threshold = config.threshold || 1024;

  return {
    async onResponse(ctx: ResponseContext, next) {
      // In a real implementation, this would compress the response body
      // For now, we just add the header
      if (ctx.response.result) {
        const size = JSON.stringify(ctx.response.result).length;
        if (size > threshold) {
          (ctx.response as any).headers = {
            'content-encoding': 'gzip',
          };
        }
      }
      return next();
    },
  };
}

// ============================================================================
// Request ID Middleware
// ============================================================================

export function requestId(): ServerMiddleware {
  return {
    async onRequest(ctx: RequestContext, next) {
      // Ensure request has an ID
      if (!ctx.message.id) {
        ctx.message.id = `req-${randomBytes(8).toString('hex')}`;
        ctx.requestId = ctx.message.id;
      }
      return next();
    },
  };
}

// ============================================================================
// CORS Middleware (for HTTP transports)
// ============================================================================

export interface CorsConfig {
  origin?: string | string[] | boolean;
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
}

export function cors(config: CorsConfig = {}): ServerMiddleware {
  return {
    async onResponse(ctx: ResponseContext, next) {
      // Only applies to HTTP transports
      if (ctx.request.transport.constructor.name.includes('Http')) {
        (ctx.response as any).headers = {
          'access-control-allow-origin': config.origin === true ? '*' : Array.isArray(config.origin) ? config.origin.join(',') : config.origin || '*',
          'access-control-allow-methods': config.methods?.join(',') || 'POST, OPTIONS',
          'access-control-allow-headers': config.allowedHeaders?.join(',') || 'Content-Type, Authorization',
          'access-control-expose-headers': config.exposedHeaders?.join(',') || '',
          'access-control-allow-credentials': config.credentials ? 'true' : 'false',
          'access-control-max-age': config.maxAge?.toString() || '86400',
        };
      }
      return next();
    },
  };
}
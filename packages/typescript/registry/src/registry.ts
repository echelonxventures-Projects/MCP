/**
 * @mcp/registry - Capability Registry & Service Discovery
 * Multi-backend registry with health checking, metadata, and event notifications
 */

import { EventEmitter } from 'events';
import {
  ServerCapabilities,
  ServerMetadata,
  EndpointConfig,
  TransportConfig,
  TransportType,
} from '@mcp/types';

// ============================================================================
// Type Definitions
// ============================================================================

export interface ServerRegistration {
  id: string;
  name: string;
  version: string;
  transport: TransportConfig;
  capabilities: ServerCapabilities;
  metadata: ServerMetadata;
  endpoints: EndpointConfig[];
  tags: string[];
  region: string;
  tenantId?: string;
  registeredAt: Date;
  updatedAt: Date;
  ttl?: number; // Time-to-live in seconds
}

export interface RegistrationResult {
  serverId: string;
  registered: boolean;
  previousVersion?: ServerRegistration;
}

export interface DiscoveryCriteria {
  capabilities?: Partial<ServerCapabilities>;
  tags?: string[];
  version?: string; // SemVer range
  region?: string;
  tenantId?: string;
  name?: string; // Exact or prefix match
  healthyOnly?: boolean;
}

export interface ServerInfo {
  id: string;
  name: string;
  version: string;
  transport: TransportConfig;
  capabilities: ServerCapabilities;
  metadata: ServerMetadata;
  endpoints: EndpointConfig[];
  tags: string[];
  region: string;
  tenantId?: string;
  status: ServerStatus;
  health: HealthInfo;
  registeredAt: Date;
  updatedAt: Date;
}

export type ServerStatus = 'registering' | 'healthy' | 'unhealthy' | 'draining' | 'terminated';

export interface HealthInfo {
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastCheck: Date;
  checks: HealthCheck[];
  consecutiveFailures: number;
}

export interface HealthCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message?: string;
  timestamp: Date;
  durationMs: number;
}

export interface HealthEvent {
  serverId: string;
  previousStatus: ServerStatus;
  currentStatus: ServerStatus;
  health: HealthInfo;
  timestamp: Date;
}

export interface RegistryConfig {
  backend: RegistryBackend;
  options: Record<string, unknown>;
  healthCheck?: HealthCheckConfig;
  cache?: CacheConfig;
}

export interface HealthCheckConfig {
  enabled: boolean;
  interval: number; // ms
  timeout: number; // ms
  threshold: number; // consecutive failures before unhealthy
  checks: HealthCheckFunction[];
}

export type HealthCheckFunction = (server: ServerRegistration) => Promise<HealthCheck>;

export interface CacheConfig {
  enabled: boolean;
  ttl: number; // ms
  maxSize: number;
}

export type RegistryBackend = 'memory' | 'redis' | 'etcd' | 'consul' | 'kubernetes' | 'custom';

// ============================================================================
// Registry Interface
// ============================================================================

export interface CapabilityRegistry extends EventEmitter {
  // Registration
  register(server: ServerRegistration): Promise<RegistrationResult>;
  unregister(serverId: string): Promise<void>;
  update(serverId: string, updates: Partial<ServerRegistration>): Promise<ServerRegistration>;
  heartbeat(serverId: string): Promise<void>;

  // Discovery
  discover(criteria: DiscoveryCriteria): Promise<ServerInfo[]>;
  get(serverId: string): Promise<ServerInfo | null>;
  list(): Promise<ServerInfo[]>;

  // Metadata
  updateMetadata(serverId: string, metadata: ServerMetadata): Promise<void>;
  addTags(serverId: string, tags: string[]): Promise<void>;
  removeTags(serverId: string, tags: string[]): Promise<void>;

  // Events
  onServerRegistered: (handler: (server: ServerInfo) => void) => void;
  onServerUnregistered: (handler: (serverId: string) => void) => void;
  onServerHealthChanged: (handler: (event: HealthEvent) => void) => void;
  onServerUpdated: (handler: (server: ServerInfo) => void) => void;

  // Lifecycle
  start(): Promise<void>;
  stop(): Promise<void>;
  isHealthy(): boolean;
}

// ============================================================================
// In-Memory Registry Implementation
// ============================================================================

export class MemoryRegistry extends EventEmitter implements CapabilityRegistry {
  private servers = new Map<string, ServerRegistration>();
  private healthStatus = new Map<string, HealthInfo>();
  private config: RegistryConfig;
  private healthCheckInterval?: NodeJS.Timeout;
  private cleanupInterval?: NodeJS.Timeout;
  private started = false;

  constructor(config: Partial<RegistryConfig> = {}) {
    super();
    this.config = {
      backend: 'memory',
      options: {},
      healthCheck: {
        enabled: true,
        interval: 30000,
        timeout: 5000,
        threshold: 3,
        checks: [defaultHealthCheck],
      },
      cache: {
        enabled: true,
        ttl: 5000,
        maxSize: 1000,
      },
      ...config,
    };
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  async register(server: ServerRegistration): Promise<RegistrationResult> {
    const existing = this.servers.get(server.id);
    const now = new Date();

    const registration: ServerRegistration = {
      ...server,
      registeredAt: existing?.registeredAt || now,
      updatedAt: now,
    };

    this.servers.set(server.id, registration);

    // Initialize health status
    this.healthStatus.set(server.id, {
      status: 'healthy',
      lastCheck: now,
      checks: [],
      consecutiveFailures: 0,
    });

    const serverInfo = this.toServerInfo(registration);
    this.emit('serverRegistered', serverInfo);

    return {
      serverId: server.id,
      registered: !existing,
      previousVersion: existing,
    };
  }

  async unregister(serverId: string): Promise<void> {
    const server = this.servers.get(serverId);
    if (!server) return;

    this.servers.delete(serverId);
    this.healthStatus.delete(serverId);

    this.emit('serverUnregistered', serverId);
  }

  async update(serverId: string, updates: Partial<ServerRegistration>): Promise<ServerRegistration> {
    const existing = this.servers.get(serverId);
    if (!existing) {
      throw new Error(`Server not found: ${serverId}`);
    }

    const updated: ServerRegistration = {
      ...existing,
      ...updates,
      id: serverId, // Prevent ID change
      updatedAt: new Date(),
    };

    this.servers.set(serverId, updated);

    const serverInfo = this.toServerInfo(updated);
    this.emit('serverUpdated', serverInfo);

    return updated;
  }

  async heartbeat(serverId: string): Promise<void> {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`Server not found: ${serverId}`);
    }

    // Update last heartbeat timestamp in metadata
    server.metadata = {
      ...server.metadata,
      lastHeartbeat: new Date().toISOString(),
    };
    server.updatedAt = new Date();
  }

  // ---------------------------------------------------------------------------
  // Discovery
  // ---------------------------------------------------------------------------

  async discover(criteria: DiscoveryCriteria): Promise<ServerInfo[]> {
    let results = Array.from(this.servers.values()).map(s => this.toServerInfo(s));

    // Filter by criteria
    if (criteria.name) {
      results = results.filter(s => s.name === criteria.name || s.name.startsWith(criteria.name!));
    }

    if (criteria.tags && criteria.tags.length > 0) {
      results = results.filter(s => criteria.tags!.every(tag => s.tags.includes(tag)));
    }

    if (criteria.region) {
      results = results.filter(s => s.region === criteria.region);
    }

    if (criteria.tenantId) {
      results = results.filter(s => s.tenantId === criteria.tenantId);
    }

    if (criteria.version) {
      results = results.filter(s => this.matchVersion(s.version, criteria.version!));
    }

    if (criteria.capabilities) {
      results = results.filter(s => this.matchCapabilities(s.capabilities, criteria.capabilities!));
    }

    if (criteria.healthyOnly !== false) {
      results = results.filter(s => s.status === 'healthy');
    }

    return results;
  }

  async get(serverId: string): Promise<ServerInfo | null> {
    const server = this.servers.get(serverId);
    if (!server) return null;
    return this.toServerInfo(server);
  }

  async list(): Promise<ServerInfo[]> {
    return Array.from(this.servers.values()).map(s => this.toServerInfo(s));
  }

  // ---------------------------------------------------------------------------
  // Metadata
  // ---------------------------------------------------------------------------

  async updateMetadata(serverId: string, metadata: ServerMetadata): Promise<void> {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`Server not found: ${serverId}`);
    }

    server.metadata = { ...server.metadata, ...metadata };
    server.updatedAt = new Date();
    this.emit('serverUpdated', this.toServerInfo(server));
  }

  async addTags(serverId: string, tags: string[]): Promise<void> {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`Server not found: ${serverId}`);
    }

    server.tags = [...new Set([...server.tags, ...tags])];
    server.updatedAt = new Date();
    this.emit('serverUpdated', this.toServerInfo(server));
  }

  async removeTags(serverId: string, tags: string[]): Promise<void> {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`Server not found: ${serverId}`);
    }

    server.tags = server.tags.filter(t => !tags.includes(t));
    server.updatedAt = new Date();
    this.emit('serverUpdated', this.toServerInfo(server));
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    // Start health checks
    if (this.config.healthCheck?.enabled) {
      this.startHealthChecks();
    }

    // Start TTL cleanup
    this.startCleanup();
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  isHealthy(): boolean {
    return this.started;
  }

  // ---------------------------------------------------------------------------
  // Event Handlers (implementing the interface)
  // ---------------------------------------------------------------------------

  onServerRegistered(handler: (server: ServerInfo) => void): void {
    this.on('serverRegistered', handler);
  }

  onServerUnregistered(handler: (serverId: string) => void): void {
    this.on('serverUnregistered', handler);
  }

  onServerHealthChanged(handler: (event: HealthEvent) => void): void {
    this.on('serverHealthChanged', handler);
  }

  onServerUpdated(handler: (server: ServerInfo) => void): void {
    this.on('serverUpdated', handler);
  }

  // ---------------------------------------------------------------------------
  // Private Methods
  // ---------------------------------------------------------------------------

  private toServerInfo(server: ServerRegistration): ServerInfo {
    const health = this.healthStatus.get(server.id) || {
      status: 'healthy' as const,
      lastCheck: new Date(),
      checks: [],
      consecutiveFailures: 0,
    };

    return {
      id: server.id,
      name: server.name,
      version: server.version,
      transport: server.transport,
      capabilities: server.capabilities,
      metadata: server.metadata,
      endpoints: server.endpoints,
      tags: server.tags,
      region: server.region,
      tenantId: server.tenantId,
      status: this.computeStatus(server, health),
      health,
      registeredAt: server.registeredAt,
      updatedAt: server.updatedAt,
    };
  }

  private computeStatus(server: ServerRegistration, health: HealthInfo): ServerStatus {
    if (health.status === 'unhealthy') return 'unhealthy';
    if (health.status === 'degraded') return 'unhealthy'; // Treat degraded as unhealthy for discovery
    return 'healthy';
  }

  private matchVersion(version: string, range: string): boolean {
    // Simple semver matching (in production, use semver library)
    if (range === '*' || range === 'latest') return true;
    if (range.startsWith('^') || range.startsWith('~')) {
      // Simplified: just check major version for ^, minor for ~
      const [major, minor] = version.split('.').map(Number);
      const [rMajor, rMinor] = range.replace(/^[\^~]/, '').split('.').map(Number);
      if (range.startsWith('^')) return major === rMajor;
      return major === rMajor && minor === rMinor;
    }
    return version === range;
  }

  private matchCapabilities(serverCaps: ServerCapabilities, required: Partial<ServerCapabilities>): boolean {
    for (const [key, value] of Object.entries(required)) {
      const serverValue = serverCaps[key as keyof ServerCapabilities];
      if (!serverValue) return false;
      // Deep equality check for capability objects
      if (JSON.stringify(serverValue) !== JSON.stringify(value)) {
        return false;
      }
    }
    return true;
  }

  private startHealthChecks(): void {
    const interval = this.config.healthCheck!.interval;
    const checks = this.config.healthCheck!.checks;
    const threshold = this.config.healthCheck!.threshold;

    this.healthCheckInterval = setInterval(async () => {
      for (const [serverId, server] of this.servers) {
        try {
          const healthResults = await Promise.all(
            checks.map(check => check(server))
          );

          const failedChecks = healthResults.filter(h => h.status === 'fail');
          const health = this.healthStatus.get(serverId)!;

          health.checks = healthResults;
          health.lastCheck = new Date();

          const previousStatus = health.status;

          if (failedChecks.length > 0) {
            health.consecutiveFailures++;
            if (health.consecutiveFailures >= threshold) {
              health.status = 'unhealthy';
            } else {
              health.status = 'degraded';
            }
          } else {
            health.consecutiveFailures = 0;
            health.status = 'healthy';
          }

          if (health.status !== previousStatus) {
            this.emit('serverHealthChanged', {
              serverId,
              previousStatus: this.computeStatus(server, { ...health, status: previousStatus }),
              currentStatus: this.computeStatus(server, health),
              health,
              timestamp: new Date(),
            });
          }
        } catch (error) {
          // Health check itself failed
          const health = this.healthStatus.get(serverId)!;
          health.consecutiveFailures++;
          if (health.consecutiveFailures >= threshold) {
            health.status = 'unhealthy';
          }
        }
      }
    }, interval);
  }

  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [serverId, server] of this.servers) {
        if (server.ttl) {
          const age = now - server.updatedAt.getTime();
          if (age > server.ttl * 1000) {
            this.unregister(serverId).catch(err => this.emit('error', err));
          }
        }
      }
    }, 60000); // Check every minute
  }
}

// ============================================================================
// Default Health Check
// ============================================================================

async function defaultHealthCheck(server: ServerRegistration): Promise<HealthCheck> {
  const start = Date.now();
  try {
    // In a real implementation, this would connect to the server's health endpoint
    // For now, just check if the server has been recently updated
    const age = Date.now() - server.updatedAt.getTime();
    if (age > 120000) { // 2 minutes
      return {
        name: 'staleness',
        status: 'fail',
        message: `Server not updated for ${Math.round(age / 1000)}s`,
        timestamp: new Date(),
        durationMs: Date.now() - start,
      };
    }
    return {
      name: 'staleness',
      status: 'pass',
      message: 'Server recently updated',
      timestamp: new Date(),
      durationMs: Date.now() - start,
    };
  } catch (error) {
    return {
      name: 'staleness',
      status: 'fail',
      message: `Health check error: ${error}`,
      timestamp: new Date(),
      durationMs: Date.now() - start,
    };
  }
}

// ============================================================================
// Registry Factory
// ============================================================================

export function createRegistry(config: Partial<RegistryConfig> = {}): CapabilityRegistry {
  const backend = config.backend || 'memory';

  switch (backend) {
    case 'memory':
      return new MemoryRegistry(config);
    case 'redis':
      return new RedisRegistry(config);
    case 'etcd':
      return new EtcdRegistry(config);
    case 'consul':
      return new ConsulRegistry(config);
    case 'kubernetes':
      return new KubernetesRegistry(config);
    case 'custom':
      if (!config.options.customAdapter) {
        throw new Error('Custom registry requires customAdapter in options');
      return config.options.customAdapter as CapabilityRegistry;
    default:
      throw new Error(`Unknown registry backend: ${backend}`);
  }
}

// ============================================================================
// Redis Registry (Stub)
// ============================================================================

class RedisRegistry extends EventEmitter implements CapabilityRegistry {
  private config: RegistryConfig;

  constructor(config: Partial<RegistryConfig>) {
    super();
    this.config = config as RegistryConfig;
  }

  async register(server: ServerRegistration): Promise<RegistrationResult> {
    throw new Error('Redis registry not yet implemented');
  }

  async unregister(serverId: string): Promise<void> {
    throw new Error('Redis registry not yet implemented');
  }

  async update(serverId: string, updates: Partial<ServerRegistration>): Promise<ServerRegistration> {
    throw new Error('Redis registry not yet implemented');
  }

  async heartbeat(serverId: string): Promise<void> {
    throw new Error('Redis registry not yet implemented');
  }

  async discover(criteria: DiscoveryCriteria): Promise<ServerInfo[]> {
    throw new Error('Redis registry not yet implemented');
  }

  async get(serverId: string): Promise<ServerInfo | null> {
    throw new Error('Redis registry not yet implemented');
  }

  async list(): Promise<ServerInfo[]> {
    throw new Error('Redis registry not yet implemented');
  }

  async updateMetadata(serverId: string, metadata: ServerMetadata): Promise<void> {
    throw new Error('Redis registry not yet implemented');
  }

  async addTags(serverId: string, tags: string[]): Promise<void> {
    throw new Error('Redis registry not yet implemented');
  }

  async removeTags(serverId: string, tags: string[]): Promise<void> {
    throw new Error('Redis registry not yet implemented');
  }

  onServerRegistered(handler: (server: ServerInfo) => void): void {
    this.on('serverRegistered', handler);
  }

  onServerUnregistered(handler: (serverId: string) => void): void {
    this.on('serverUnregistered', handler);
  }

  onServerHealthChanged(handler: (event: HealthEvent) => void): void {
    this.on('serverHealthChanged', handler);
  }

  onServerUpdated(handler: (server: ServerInfo) => void): void {
    this.on('serverUpdated', handler);
  }

  async start(): Promise<void> {
    throw new Error('Redis registry not yet implemented');
  }

  async stop(): Promise<void> {
    throw new Error('Redis registry not yet implemented');
  }

  isHealthy(): boolean {
    return false;
  }
}

// ============================================================================
// Etcd Registry (Stub)
// ============================================================================

class EtcdRegistry extends RedisRegistry {}

// ============================================================================
// Consul Registry (Stub)
// ============================================================================

class ConsulRegistry extends RedisRegistry {}

// ============================================================================
// Kubernetes Registry (Stub)
// ============================================================================

class KubernetesRegistry extends RedisRegistry {}
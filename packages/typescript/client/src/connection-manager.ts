/**
 * @mcp/client - MCP Client Framework
 * Connection pooling, failover, context management for host applications
 */

import { EventEmitter } from 'events';
import {
  MCPMessage,
  MCPError,
  ServerCapabilities,
  ClientCapabilities,
  Tool,
  Resource,
  Prompt,
  CallToolResult,
  ReadResourceResult,
  GetPromptResult,
  ListToolsResult,
  ListResourcesResult,
  ListPromptsResult,
  ToolAnnotations,
  ResourceAnnotations,
  PromptArgument,
  JSONSchema,
  createMCPError,
  ERROR_CODES,
  isResponse,
  isErrorResponse,
} from '@mcp/types';

import { Transport, TransportConfig, TransportType, createTransport } from '@mcp/transports';

// ============================================================================
// Type Definitions
// ============================================================================

export interface ConnectionConfig {
  serverId: string;
  transport: TransportType | TransportConfig | Transport;
  capabilities?: ClientCapabilities;
  timeout?: number;
  retry?: RetryConfig;
  failover?: FailoverConfig;
}

export interface RetryConfig {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  retryableErrors?: number[];
}

export interface FailoverConfig {
  enabled: boolean;
  backupServers: string[];
  healthCheckInterval: number;
  failoverTimeout: number;
}

export interface Connection {
  readonly serverId: string;
  readonly transport: Transport;
  readonly capabilities: ServerCapabilities;
  readonly status: ConnectionStatus;
  readonly connectedAt: Date;
  readonly lastActivity: Date;

  request(method: string, params?: unknown): Promise<unknown>;
  notify(method: string, params?: unknown): Promise<void>;
  stream(method: string, params?: unknown): AsyncIterable<unknown>;
  close(): Promise<void>;
  onClose(handler: (error?: Error) => void): void;
  onError(handler: (error: Error) => void): void;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'failed';

export interface PoolConfig {
  maxConnections: number;
  minConnections: number;
  acquireTimeout: number;
  idleTimeout: number;
  healthCheckInterval: number;
}

export interface McpContext {
  requestId: string;
  parentRequestId?: string;
  metadata: Record<string, unknown>;
  traceId?: string;
  spanId?: string;
  tenantId?: string;
  userId?: string;
}

export interface ConnectionManagerEvents {
  connectionCreated: [Connection];
  connectionClosed: [Connection, Error?];
  connectionError: [Connection, Error];
  connectionFailed: [string, Error];
  failover: [string, string]; // fromServerId, toServerId
  poolExhausted: [string]; // serverId
}

// ============================================================================
// Default Configurations
// ============================================================================

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2,
  retryableErrors: [
    ERROR_CODES.INTERNAL_ERROR,
    ERROR_CODES.SERVICE_UNAVAILABLE,
    ERROR_CODES.TIMEOUT,
  ],
};

const DEFAULT_FAILOVER_CONFIG: FailoverConfig = {
  enabled: false,
  backupServers: [],
  healthCheckInterval: 30000,
  failoverTimeout: 5000,
};

const DEFAULT_POOL_CONFIG: PoolConfig = {
  maxConnections: 10,
  minConnections: 0,
  acquireTimeout: 5000,
  idleTimeout: 60000,
  healthCheckInterval: 30000,
};

// ============================================================================
// Connection Implementation
// ============================================================================

class ManagedConnection extends EventEmitter implements Connection {
  public readonly serverId: string;
  public readonly transport: Transport;
  public readonly capabilities: ServerCapabilities;
  public status: ConnectionStatus = 'connecting';
  public readonly connectedAt: Date = new Date();
  public lastActivity: Date = new Date();

  private requestId = 0;
  private pendingRequests = new Map<string | number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();
  private closed = false;
  private closeHandlers: Array<(error?: Error) => void> = [];
  private errorHandlers: Array<(error: Error) => void> = [];
  private retryConfig: RetryConfig;
  private failoverConfig: FailoverConfig;
  private healthCheckInterval?: NodeJS.Timeout;

  constructor(
    serverId: string,
    transport: Transport,
    capabilities: ServerCapabilities,
    retryConfig: RetryConfig,
    failoverConfig: FailoverConfig
  ) {
    super();
    this.serverId = serverId;
    this.transport = transport;
    this.capabilities = capabilities;
    this.retryConfig = retryConfig;
    this.failoverConfig = failoverConfig;

    this.setupTransportHandlers();
  }

  private setupTransportHandlers(): void {
    this.transport.onConnect = () => {
      this.status = 'connected';
      this.emit('connect');
      this.startHealthCheck();
    };

    this.transport.onDisconnect = (error) => {
      this.status = error ? 'failed' : 'disconnected';
      this.stopHealthCheck();
      this.rejectAllPending(error || new Error('Connection closed'));
      this.emit('close', error);
      this.closeHandlers.forEach(h => h(error));
    };

    this.transport.onError = (error) => {
      this.errorHandlers.forEach(h => h(error));
      this.emit('error', error);
    };
  }

  private startHealthCheck(): void {
    if (this.failoverConfig.enabled && this.failoverConfig.healthCheckInterval > 0) {
      this.healthCheckInterval = setInterval(() => {
        this.ping().catch(() => {}); // Health check failure handled by transport
      }, this.failoverConfig.healthCheckInterval);
    }
  }

  private stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
  }

  async connect(): Promise<void> {
    await this.transport.connect();
  }

  async disconnect(): Promise<void> {
    this.closed = true;
    this.stopHealthCheck();
    await this.transport.disconnect();
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    if (this.status !== 'connected') {
      throw new Error(`Connection not ready: ${this.status}`);
    }

    const id = ++this.requestId;
    const message: MCPMessage = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, this.retryConfig.maxDelay);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      this.transport.send(message).catch(reject);
    });
  }

  async notify(method: string, params?: unknown): Promise<void> {
    if (this.status !== 'connected') {
      throw new Error(`Connection not ready: ${this.status}`);
    }

    const message: MCPMessage = {
      jsonrpc: '2.0',
      method,
      params,
    };

    await this.transport.send(message);
  }

  async *stream(method: string, params?: unknown): AsyncIterable<unknown> {
    // For streaming, we'd need a specific protocol extension
    // This is a placeholder for future implementation
    throw new Error('Streaming not yet implemented');
  }

  async close(): Promise<void> {
    await this.disconnect();
  }

  onClose(handler: (error?: Error) => void): void {
    this.closeHandlers.push(handler);
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandlers.push(handler);
  }

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private handleResponse(message: MCPMessage): void {
    const pending = this.pendingRequests.get(message.id!);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(message.id!);

    if (isErrorResponse(message)) {
      pending.reject(createMCPError(message.id, message.error.code, message.error.message, message.error.data));
    } else {
      pending.resolve(message.result);
    }
  }

  async ping(): Promise<void> {
    await this.request('ping');
  }
}

// ============================================================================
// Connection Pool
// ============================================================================

class ConnectionPool extends EventEmitter {
  private connections: ManagedConnection[] = [];
  private available: ManagedConnection[] = [];
  private acquiring = 0;
  private config: PoolConfig;
  private serverId: string;
  private transportFactory: () => Promise<Transport>;
  private retryConfig: RetryConfig;
  private failoverConfig: FailoverConfig;
  private healthCheckInterval?: NodeJS.Timeout;

  constructor(
    serverId: string,
    config: PoolConfig,
    transportFactory: () => Promise<Transport>,
    retryConfig: RetryConfig,
    failoverConfig: FailoverConfig
  ) {
    super();
    this.serverId = serverId;
    this.config = config;
    this.transportFactory = transportFactory;
    this.retryConfig = retryConfig;
    this.failoverConfig = failoverConfig;
  }

  async acquire(): Promise<ManagedConnection> {
    // Try to get an available connection
    while (this.available.length > 0) {
      const conn = this.available.pop()!;
      if (conn.status === 'connected') {
        return conn;
      }
      // Connection is stale, clean it up
      await this.destroyConnection(conn);
    }

    // Check if we can create a new connection
    if (this.connections.length >= this.config.maxConnections) {
      // Wait for a connection to become available
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Pool exhausted for ${this.serverId}`));
          this.emit('poolExhausted', this.serverId);
        }, this.config.acquireTimeout);

        const onAvailable = (conn: ManagedConnection) => {
          clearTimeout(timeout);
          this.off('available', onAvailable);
          resolve(conn);
        };

        this.on('available', onAvailable);
      });
    }

    // Create new connection
    this.acquiring++;
    try {
      const transport = await this.transportFactory();
      const conn = await this.createConnection(transport);
      this.connections.push(conn);
      return conn;
    } finally {
      this.acquiring--;
    }
  }

  release(connection: ManagedConnection): void {
    if (connection.status === 'connected' && !connection.closed) {
      this.available.push(connection);
      this.emit('available', connection);
    } else {
      this.destroyConnection(connection);
    }
  }

  private async createConnection(transport: Transport): Promise<ManagedConnection> {
    const conn = new ManagedConnection(
      this.serverId,
      transport,
      {}, // Capabilities will be set after initialize
      this.retryConfig,
      this.failoverConfig
    );

    await conn.connect();

    // Initialize the connection
    const initResult = await conn.request('initialize', {
      protocolVersion: '1.0',
      capabilities: {},
      clientInfo: { name: 'mcp-client', version: '0.1.0' },
    }) as { capabilities: ServerCapabilities };

    conn.capabilities = initResult.capabilities;
    await conn.notify('initialized', {});

    conn.onClose(() => this.removeConnection(conn));
    conn.onError((error) => this.emit('connectionError', conn, error));

    this.emit('connectionCreated', conn);
    return conn;
  }

  private async destroyConnection(conn: ManagedConnection): Promise<void> {
    const index = this.connections.indexOf(conn);
    if (index >= 0) {
      this.connections.splice(index, 1);
    }
    const availIndex = this.available.indexOf(conn);
    if (availIndex >= 0) {
      this.available.splice(availIndex, 1);
    }
    await conn.close();
    this.emit('connectionClosed', conn);
  }

  private removeConnection(conn: ManagedConnection): void {
    this.destroyConnection(conn);
  }

  async initialize(): Promise<void> {
    // Pre-warm minimum connections
    for (let i = 0; i < this.config.minConnections; i++) {
      try {
        const transport = await this.transportFactory();
        const conn = await this.createConnection(transport);
        this.connections.push(conn);
        this.available.push(conn);
      } catch (error) {
        this.emit('connectionError', null, error as Error);
      }
    }

    // Start health check for idle connections
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckInterval);
  }

  private async performHealthCheck(): Promise<void> {
    const now = Date.now();
    for (const conn of this.available) {
      if (now - conn.lastActivity.getTime() > this.config.idleTimeout) {
        // Check if connection is still alive
        try {
          await conn.ping();
        } catch {
          await this.destroyConnection(conn);
        }
      }
    }
  }

  async shutdown(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    for (const conn of this.connections) {
      await conn.close();
    }
    this.connections = [];
    this.available = [];
  }

  getStats(): { total: number; available: number; acquiring: number } {
    return {
      total: this.connections.length,
      available: this.available.length,
      acquiring: this.acquiring,
    };
  }
}

// ============================================================================
// Connection Manager
// ============================================================================

export class ConnectionManager extends EventEmitter {
  private pools = new Map<string, ConnectionPool>();
  private configs = new Map<string, ConnectionConfig>();
  private contexts = new Map<string, McpContext>();
  private contextCounter = 0;

  constructor() {
    super();
  }

  // ---------------------------------------------------------------------------
  // Pool Management
  // ---------------------------------------------------------------------------

  async connect(config: ConnectionConfig): Promise<Connection> {
    const { serverId } = config;
    this.configs.set(serverId, config);

    let pool = this.pools.get(serverId);
    if (!pool) {
      const poolConfig: PoolConfig = { ...DEFAULT_POOL_CONFIG };
      const retryConfig: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config.retry };
      const failoverConfig: FailoverConfig = { ...DEFAULT_FAILOVER_CONFIG, ...config.failover };

      const transportFactory = async () => {
        if (config.transport instanceof Transport) {
          return config.transport;
        } else if (typeof config.transport === 'string') {
          return createTransport({ type: config.transport });
        } else {
          return createTransport(config.transport);
        }
      };

      pool = new ConnectionPool(serverId, poolConfig, transportFactory, retryConfig, failoverConfig);
      pool.on('connectionCreated', (conn) => this.emit('connectionCreated', conn));
      pool.on('connectionClosed', (conn, err) => this.emit('connectionClosed', conn, err));
      pool.on('connectionError', (conn, err) => this.emit('connectionError', conn, err));
      pool.on('poolExhausted', (sid) => this.emit('poolExhausted', sid));

      await pool.initialize();
      this.pools.set(serverId, pool);
    }

    return pool.acquire();
  }

  getConnection(serverId: string): Connection | null {
    const pool = this.pools.get(serverId);
    if (!pool) return null;
    // Return first available connection or null
    const stats = pool.getStats();
    return stats.available > 0 ? null : null; // Would need pool API to get actual connection
  }

  async getOrCreateConnection(serverId: string): Promise<Connection> {
    const config = this.configs.get(serverId);
    if (!config) {
      throw new Error(`No configuration for server: ${serverId}`);
    }
    return this.connect(config);
  }

  // ---------------------------------------------------------------------------
  // Failover & Resilience
  // ---------------------------------------------------------------------------

  onConnectionLost(serverId: string, handler: (error: Error) => void): void {
    this.on(`connectionLost:${serverId}`, handler);
  }

  enableFailover(config: FailoverConfig): void {
    // Failover is configured per-connection via ConnectionConfig
    // This method could update all existing pools
    for (const [serverId, poolConfig] of this.configs) {
      this.configs.set(serverId, { ...poolConfig, failover: config });
    }
  }

  // ---------------------------------------------------------------------------
  // Context Propagation
  // ---------------------------------------------------------------------------

  createContext(parent?: McpContext): McpContext {
    const contextId = `ctx-${++this.contextCounter}`;
    const context: McpContext = {
      requestId: contextId,
      parentRequestId: parent?.requestId,
      metadata: { ...parent?.metadata },
      traceId: parent?.traceId,
      spanId: parent?.spanId,
      tenantId: parent?.tenantId,
      userId: parent?.userId,
    };
    this.contexts.set(contextId, context);
    return context;
  }

  getContext(contextId: string): McpContext | undefined {
    return this.contexts.get(contextId);
  }

  deleteContext(contextId: string): void {
    this.contexts.delete(contextId);
  }

  async runWithContext<T>(context: McpContext, fn: () => Promise<T>): Promise<T> {
    // Store context for access during execution
    const previousContext = this.getCurrentContext();
    this.setCurrentContext(context);

    try {
      return await fn();
    } finally {
      if (previousContext) {
        this.setCurrentContext(previousContext);
      } else {
        this.clearCurrentContext();
      }
    }
  }

  private currentContext: McpContext | null = null;

  private getCurrentContext(): McpContext | null {
    return this.currentContext;
  }

  private setCurrentContext(context: McpContext): void {
    this.currentContext = context;
  }

  private clearCurrentContext(): void {
    this.currentContext = null;
  }

  // ---------------------------------------------------------------------------
  // High-Level Operations
  // ---------------------------------------------------------------------------

  async invokeTool(serverId: string, tool: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const conn = await this.getOrCreateConnection(serverId);
    try {
      return await conn.request('tools/call', { name: tool, arguments: args }) as CallToolResult;
    } finally {
      // Return connection to pool (would need pool reference)
    }
  }

  async invokeToolStreaming(serverId: string, tool: string, args: Record<string, unknown>): Promise<AsyncIterable<CallToolResult>> {
    const conn = await this.getOrCreateConnection(serverId);
    // Streaming implementation would go here
    throw new Error('Streaming not yet implemented');
  }

  async readResource(serverId: string, uri: string): Promise<ReadResourceResult> {
    const conn = await this.getOrCreateConnection(serverId);
    return await conn.request('resources/read', { uri }) as ReadResourceResult;
  }

  async subscribeResource(serverId: string, uri: string, handler: (update: unknown) => void): Promise<() => void> {
    const conn = await this.getOrCreateConnection(serverId);
    await conn.request('resources/subscribe', { uri });
    // Would need to handle subscription updates
    return () => conn.request('resources/unsubscribe', { uri });
  }

  async renderPrompt(serverId: string, name: string, args: Record<string, unknown>): Promise<GetPromptResult> {
    const conn = await this.getOrCreateConnection(serverId);
    return await conn.request('prompts/get', { name, arguments: args }) as GetPromptResult;
  }

  async listTools(serverId: string): Promise<Tool[]> {
    const conn = await this.getOrCreateConnection(serverId);
    const result = await conn.request('tools/list') as ListToolsResult;
    return result.tools;
  }

  async listResources(serverId: string): Promise<Resource[]> {
    const conn = await this.getOrCreateConnection(serverId);
    const result = await conn.request('resources/list') as ListResourcesResult;
    return result.resources;
  }

  async listPrompts(serverId: string): Promise<Prompt[]> {
    const conn = await this.getOrCreateConnection(serverId);
    const result = await conn.request('prompts/list') as ListPromptsResult;
    return result.prompts;
  }

  // ---------------------------------------------------------------------------
  // Shutdown
  // ---------------------------------------------------------------------------

  async shutdown(): Promise<void> {
    for (const pool of this.pools.values()) {
      await pool.shutdown();
    }
    this.pools.clear();
    this.configs.clear();
    this.contexts.clear();
  }
}

// ============================================================================
// MCP Client Facade
// ============================================================================

export interface McpClient {
  readonly serverId: string;
  readonly capabilities: ServerCapabilities;

  // Tools
  listTools(): Promise<Tool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
  callToolStreaming(name: string, args: Record<string, unknown>): AsyncIterable<CallToolResult>;

  // Resources
  listResources(): Promise<Resource[]>;
  readResource(uri: string): Promise<ReadResourceResult>;
  subscribeResource(uri: string, handler: (update: unknown) => void): Promise<() => void>;

  // Prompts
  listPrompts(): Promise<Prompt[]>;
  getPrompt(name: string, args: Record<string, unknown>): Promise<GetPromptResult>;

  // Lifecycle
  close(): Promise<void>;
}

export class DefaultMcpClient implements McpClient {
  private connection: Connection;
  private manager: ConnectionManager;
  private serverId: string;

  constructor(connection: Connection, manager: ConnectionManager, serverId: string) {
    this.connection = connection;
    this.manager = manager;
    this.serverId = serverId;
  }

  get capabilities(): ServerCapabilities {
    return this.connection.capabilities;
  }

  async listTools(): Promise<Tool[]> {
    return this.manager.listTools(this.serverId);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    return this.manager.invokeTool(this.serverId, name, args);
  }

  async *callToolStreaming(name: string, args: Record<string, unknown>): AsyncIterable<CallToolResult> {
    for await (const result of this.manager.invokeToolStreaming(this.serverId, name, args)) {
      yield result;
    }
  }

  async listResources(): Promise<Resource[]> {
    return this.manager.listResources(this.serverId);
  }

  async readResource(uri: string): Promise<ReadResourceResult> {
    return this.manager.readResource(this.serverId, uri);
  }

  async subscribeResource(uri: string, handler: (update: unknown) => void): Promise<() => void> {
    return this.manager.subscribeResource(this.serverId, uri, handler);
  }

  async listPrompts(): Promise<Prompt[]> {
    return this.manager.listPrompts(this.serverId);
  }

  async getPrompt(name: string, args: Record<string, unknown>): Promise<GetPromptResult> {
    return this.manager.renderPrompt(this.serverId, name, args);
  }

  async close(): Promise<void> {
    await this.connection.close();
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createConnectionManager(): ConnectionManager {
  return new ConnectionManager();
}

export async function connectToServer(
  manager: ConnectionManager,
  config: ConnectionConfig
): Promise<McpClient> {
  const connection = await manager.connect(config);
  return new DefaultMcpClient(connection, manager, config.serverId);
}
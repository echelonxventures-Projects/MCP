/**
 * @mcp/transports - Custom Transport Implementation
 * For edge deployments, proprietary protocols, and custom integrations
 */

import { EventEmitter } from 'events';
import {
  Transport,
  TransportType,
  TransportConfig,
  TransportCapabilities,
  CustomTransportConfig,
  TransportError,
  TransportConnectionError,
  MCPMessage,
} from '@mcp/types';

// ============================================================================
// Custom Transport Handlers Interface
// ============================================================================

export interface CustomTransportHandlers {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  send: (message: MCPMessage) => Promise<void>;
  receive: () => AsyncIterable<MCPMessage>;
  isConnected?: () => boolean;
  isConnecting?: () => boolean;
}

export interface CustomTransportEventHandlers {
  onConnect?: () => void;
  onDisconnect?: (error?: Error) => void;
  onError?: (error: Error) => void;
}

// ============================================================================
// Custom Transport Implementation
// ============================================================================

export class CustomTransport extends EventEmitter implements Transport {
  public readonly type: TransportType = 'custom';
  public readonly capabilities: TransportCapabilities;

  private handlers: CustomTransportHandlers;
  private eventHandlers: CustomTransportEventHandlers;
  private connected = false;
  private connecting = false;

  constructor(config: CustomTransportConfig) {
    super();

    this.capabilities = {
      streaming: config.capabilities?.streaming ?? true,
      bidirectional: config.capabilities?.bidirectional ?? true,
      maxMessageSize: config.capabilities?.maxMessageSize || 10 * 1024 * 1024,
    };

    this.handlers = config.handlers;
    this.eventHandlers = config.eventHandlers || {};
  }

  async connect(): Promise<void> {
    if (this.connected || this.connecting) return;
    this.connecting = true;

    try {
      await this.handlers.connect();
      this.connected = true;
      this.connecting = false;
      this.emitConnect();
    } catch (error) {
      this.connecting = false;
      throw new TransportConnectionError('custom', 'Failed to connect', error as Error);
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;

    try {
      await this.handlers.disconnect();
    } finally {
      this.handleDisconnect();
    }
  }

  async send(message: MCPMessage): Promise<void> {
    if (!this.connected) {
      throw new TransportConnectionError('custom', 'Not connected');
    }

    await this.handlers.send(message);
  }

  async *receive(): AsyncIterable<MCPMessage> {
    for await (const message of this.handlers.receive()) {
      yield message;
    }
  }

  isConnected(): boolean {
    if (this.handlers.isConnected) {
      return this.handlers.isConnected();
    }
    return this.connected;
  }

  isConnecting(): boolean {
    if (this.handlers.isConnecting) {
      return this.handlers.isConnecting();
    }
    return this.connecting;
  }

  private handleDisconnect(error?: Error): void {
    this.connected = false;
    this.connecting = false;
    this.emitDisconnect(error);
  }

  private emitConnect(): void {
    this.emit('connect');
    this.eventHandlers.onConnect?.();
    this.onConnect?.();
  }

  private emitDisconnect(error?: Error): void {
    this.emit('disconnect', error);
    this.eventHandlers.onDisconnect?.(error);
    this.onDisconnect?.(error);
  }

  private emitError(error: Error): void {
    this.emit('error', error);
    this.eventHandlers.onError?.(error);
    this.onError?.(error);
  }
}

// ============================================================================
// Edge Transport (Cloudflare Workers, Vercel Edge, etc.)
// ============================================================================

export interface EdgeTransportConfig {
  endpoint: string;
  apiKey?: string;
  headers?: Record<string, string>;
  maxMessageSize?: number;
}

export class EdgeTransport extends EventEmitter implements Transport {
  public readonly type: TransportType = 'custom';
  public readonly capabilities: TransportCapabilities = {
    streaming: true,
    bidirectional: false, // Edge functions typically use request/response
    maxMessageSize: 1024 * 1024, // 1MB for edge
  };

  private config: EdgeTransportConfig;
  private connected = false;
  private messageQueue: MCPMessage[] = [];
  private messageResolvers: Array<(value: IteratorResult<MCPMessage>) => void> = [];

  // Lifecycle hooks
  onConnect?: () => void;
  onDisconnect?: (error?: Error) => void;
  onError?: (error: Error) => void;

  constructor(config: EdgeTransportConfig) {
    super();
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    // Edge transport is stateless - just validate endpoint
    try {
      const response = await fetch(`${this.config.endpoint}/health`, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`);
      }

      this.connected = true;
      this.emitConnect();
    } catch (error) {
      throw new TransportConnectionError('custom', 'Edge health check failed', error as Error);
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emitDisconnect();
  }

  async send(message: MCPMessage): Promise<void> {
    if (!this.connected) {
      throw new TransportConnectionError('custom', 'Not connected');
    }

    const response = await fetch(`${this.config.endpoint}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.getHeaders(),
      },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      throw new TransportError('custom', `HTTP ${response.status}: ${response.statusText}`);
    }
  }

  async *receive(): AsyncIterable<MCPMessage> {
    // Edge transport typically doesn't support server-push
    // This would need WebSocket or polling for bidirectional
    while (this.connected || this.messageQueue.length > 0) {
      if (this.messageQueue.length > 0) {
        yield this.messageQueue.shift()!;
      } else {
        yield new Promise<MCPMessage>((resolve) => {
          this.messageResolvers.push((result) => resolve(result.value));
        });
      }
    }
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      ...this.config.headers,
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    return headers;
  }

  isConnected(): boolean {
    return this.connected;
  }

  isConnecting(): boolean {
    return false;
  }

  private emitConnect(): void {
    this.emit('connect');
    this.onConnect?.();
  }

  private emitDisconnect(error?: Error): void {
    this.emit('disconnect', error);
    this.onDisconnect?.(error);
  }

  private emitError(error: Error): void {
    this.emit('error', error);
    this.onError?.(error);
  }
}

// ============================================================================
// WebSocket over HTTP Upgrade (for edge-compatible WebSocket)
// ============================================================================

export interface EdgeWebSocketConfig {
  endpoint: string;
  protocols?: string[];
  headers?: Record<string, string>;
  maxMessageSize?: number;
  reconnectAttempts?: number;
  reconnectDelay?: number;
}

export class EdgeWebSocketTransport extends EventEmitter implements Transport {
  public readonly type: TransportType = 'custom';
  public readonly capabilities: TransportCapabilities = {
    streaming: true,
    bidirectional: true,
    maxMessageSize: 16 * 1024 * 1024,
  };

  private config: EdgeWebSocketConfig;
  private ws: WebSocket | null = null;
  private connected = false;
  private connecting = false;
  private shouldReconnect = false;
  private reconnectAttempts = 0;
  private messageQueue: MCPMessage[] = [];
  private messageResolvers: Array<(value: IteratorResult<MCPMessage>) => void> = [];

  // Lifecycle hooks
  onConnect?: () => void;
  onDisconnect?: (error?: Error) => void;
  onError?: (error: Error) => void;

  constructor(config: EdgeWebSocketConfig) {
    super();
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.connected || this.connecting) return;
    this.connecting = true;
    this.shouldReconnect = true;

    return new Promise((resolve, reject) => {
      try {
        // Use standard WebSocket API (available in edge runtimes)
        this.ws = new WebSocket(this.config.endpoint, this.config.protocols);

        // Set headers if supported (Cloudflare Workers, etc.)
        // Note: Standard WebSocket doesn't support custom headers
        // This is a limitation - edge runtimes may provide alternatives

        this.ws.onopen = () => {
          this.reconnectAttempts = 0;
          this.connected = true;
          this.connecting = false;
          this.emitConnect();
          resolve();
        };

        this.ws.onclose = (event) => {
          const error = event.code !== 1000
            ? new TransportConnectionError('custom', `Connection closed: ${event.reason}`, undefined, { code: event.code })
            : undefined;
          this.handleDisconnect(error);
        };

        this.ws.onerror = (event) => {
          this.emitError(new TransportConnectionError('custom', 'WebSocket error', event as any));
          if (!this.connected) {
            reject(new TransportConnectionError('custom', 'WebSocket connection failed'));
          }
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };
      } catch (error) {
        this.connecting = false;
        reject(new TransportConnectionError('custom', 'Failed to create WebSocket', error as Error));
      }
    });
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;

    const maxAttempts = this.config.reconnectAttempts ?? 5;
    const delay = this.config.reconnectDelay ?? 1000;

    if (this.reconnectAttempts >= maxAttempts) return;

    this.reconnectAttempts++;
    const reconnectDelay = delay * Math.pow(2, this.reconnectAttempts - 1);

    setTimeout(() => {
      if (this.shouldReconnect && !this.connected) {
        this.connect().catch(() => {});
      }
    }, reconnectDelay);
  }

  private handleDisconnect(error?: Error): void {
    this.connected = false;
    this.connecting = false;
    this.emitDisconnect(error);
    this.scheduleReconnect();
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(1000, 'Client disconnect');
    }
    this.ws = null;
  }

  async send(message: MCPMessage): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new TransportConnectionError('custom', 'Not connected');
    }

    this.ws.send(JSON.stringify(message));
  }

  async *receive(): AsyncIterable<MCPMessage> {
    while (this.connected || this.messageQueue.length > 0) {
      if (this.messageQueue.length > 0) {
        yield this.messageQueue.shift()!;
      } else {
        yield new Promise<MCPMessage>((resolve) => {
          this.messageResolvers.push((result) => resolve(result.value));
        });
      }
    }
  }

  private handleMessage(data: string | Buffer): void {
    try {
      const message = JSON.parse(data.toString()) as MCPMessage;

      if (this.messageResolvers.length > 0) {
        const resolver = this.messageResolvers.shift()!;
        resolver({ value: message, done: false });
      } else {
        this.messageQueue.push(message);
      }
    } catch (error) {
      this.emitError(new TransportError('custom', `Failed to parse message: ${error}`, error as Error));
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  isConnecting(): boolean {
    return this.connecting;
  }

  private emitConnect(): void {
    this.emit('connect');
    this.onConnect?.();
  }

  private emitDisconnect(error?: Error): void {
    this.emit('disconnect', error);
    this.onDisconnect?.(error);
  }

  private emitError(error: Error): void {
    this.emit('error', error);
    this.onError?.(error);
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createCustomTransport(config: CustomTransportConfig): CustomTransport {
  return new CustomTransport(config);
}

export function createEdgeTransport(config: EdgeTransportConfig): EdgeTransport {
  return new EdgeTransport(config);
}

export function createEdgeWebSocketTransport(config: EdgeWebSocketConfig): EdgeWebSocketTransport {
  return new EdgeWebSocketTransport(config);
}

// ============================================================================
// Transport Adapter (wraps any async iterator as a transport)
// ============================================================================

export interface TransportAdapterConfig {
  name: string;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  send: (message: MCPMessage) => Promise<void>;
  receive: () => AsyncIterable<MCPMessage>;
  capabilities?: Partial<TransportCapabilities>;
}

export function createTransportAdapter(config: TransportAdapterConfig): Transport {
  const emitter = new EventEmitter();

  const transport: Transport = {
    type: 'custom' as TransportType,
    capabilities: {
      streaming: true,
      bidirectional: true,
      maxMessageSize: 10 * 1024 * 1024,
      ...config.capabilities,
    },
    connect: config.connect,
    disconnect: config.disconnect,
    send: config.send,
    receive: config.receive,
    onConnect: undefined,
    onDisconnect: undefined,
    onError: undefined,
  };

  // Forward events
  const originalConnect = transport.connect;
  transport.connect = async () => {
    await originalConnect();
    emitter.emit('connect');
  };

  const originalDisconnect = transport.disconnect;
  transport.disconnect = async () => {
    await originalDisconnect();
    emitter.emit('disconnect');
  };

  return transport;
}
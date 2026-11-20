/**
 * @mcp/transports - WebSocket Transport Implementation
 * Real-time bidirectional transport for production deployments
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import {
  Transport,
  TransportType,
  TransportConfig,
  TransportCapabilities,
  WebSocketTransportConfig,
  TransportError,
  TransportConnectionError,
  MCPMessage,
} from '@mcp/types';

// ============================================================================
// WebSocket Transport Implementation
// ============================================================================

export class WebSocketTransport extends EventEmitter implements Transport {
  public readonly type: TransportType = 'websocket';
  public readonly capabilities: TransportCapabilities;

  private ws: WebSocket | null = null;
  private url: string;
  private protocols: string[];
  private messageQueue: MCPMessage[] = [];
  private messageResolvers: Array<(value: IteratorResult<MCPMessage>) => void> = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts: number;
  private reconnectDelay: number;
  private shouldReconnect = false;
  private connected = false;
  private connecting = false;
  private heartbeatInterval?: NodeJS.Timeout;

  // Lifecycle hooks
  onConnect?: () => void;
  onDisconnect?: (error?: Error) => void;
  onError?: (error: Error) => void;

  constructor(config: WebSocketTransportConfig) {
    super();

    this.capabilities = {
      streaming: true,
      bidirectional: true,
      maxMessageSize: config.maxMessageSize || 16 * 1024 * 1024, // 16MB
      compression: config.compression,
    };

    this.url = config.url;
    this.protocols = config.protocols || ['mcp'];
    this.maxReconnectAttempts = config.maxReconnectAttempts ?? 5;
    this.reconnectDelay = config.reconnectDelay ?? 1000;
  }

  async connect(): Promise<void> {
    if (this.connected || this.connecting) return;
    this.connecting = true;
    this.shouldReconnect = true;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url, this.protocols);

        this.ws.on('open', () => {
          this.reconnectAttempts = 0;
          this.connected = true;
          this.connecting = false;
          this.startHeartbeat();
          this.emitConnect();
          resolve();
        });

        this.ws.on('close', (code: number, reason: Buffer) => {
          const error = code !== 1000
            ? new TransportConnectionError('websocket', `Connection closed: ${reason.toString()}`, undefined, { code })
            : undefined;
          this.handleDisconnect(error);
        });

        this.ws.on('error', (error: Error) => {
          this.emitError(new TransportConnectionError('websocket', 'WebSocket error', error));
          if (!this.connected) {
            reject(error);
          }
        });

        this.ws.on('message', (data: Buffer | string) => {
          this.handleMessage(data);
        });
      } catch (error) {
        this.connecting = false;
        reject(new TransportConnectionError('websocket', 'Failed to create WebSocket', error as Error));
      }
    });
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 30000); // Ping every 30 seconds
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectAttempts >= this.maxReconnectAttempts) {
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    setTimeout(() => {
      if (this.shouldReconnect && !this.connected) {
        this.connect().catch(() => {}); // Errors handled by onerror
      }
    }, delay);
  }

  private handleDisconnect(error?: Error): void {
    this.connected = false;
    this.connecting = false;
    this.stopHeartbeat();
    this.emitDisconnect(error);
    this.scheduleReconnect();
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    this.stopHeartbeat();

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(1000, 'Client disconnect');
    }
    this.ws = null;
  }

  async send(message: MCPMessage): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new TransportConnectionError('websocket', 'Not connected');
    }

    const data = JSON.stringify(message);

    return new Promise((resolve, reject) => {
      this.ws!.send(data, (error) => {
        if (error) {
          reject(new TransportConnectionError('websocket', error.message, error));
        } else {
          resolve();
        }
      });
    });
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

  private handleMessage(data: Buffer | string): void {
    try {
      const message = JSON.parse(data.toString()) as MCPMessage;

      if (this.messageResolvers.length > 0) {
        const resolver = this.messageResolvers.shift()!;
        resolver({ value: message, done: false });
      } else {
        this.messageQueue.push(message);
      }
    } catch (error) {
      this.emitError(new TransportError('websocket', `Failed to parse message: ${error}`, error as Error));
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
// WebSocket Server Transport (for accepting connections)
// ============================================================================

export interface WebSocketServerTransportConfig {
  port: number;
  host?: string;
  path?: string;
  maxMessageSize?: number;
  compression?: string;
  verifyClient?: (info: { origin: string; req: any }) => boolean | Promise<boolean>;
}

export class WebSocketServerTransport extends EventEmitter implements Transport {
  public readonly type: TransportType = 'websocket';
  public readonly capabilities: TransportCapabilities;

  private server: WebSocket.Server | null = null;
  private clients = new Set<WebSocket>();
  private config: WebSocketServerTransportConfig;
  private connected = false;
  private messageQueue: MCPMessage[] = [];
  private messageResolvers: Array<(value: IteratorResult<MCPMessage>) => void> = [];

  // Lifecycle hooks
  onConnect?: () => void;
  onDisconnect?: (error?: Error) => void;
  onError?: (error: Error) => void;

  constructor(config: WebSocketServerTransportConfig) {
    super();

    this.config = config;
    this.capabilities = {
      streaming: true,
      bidirectional: true,
      maxMessageSize: config.maxMessageSize || 16 * 1024 * 1024,
      compression: config.compression as any,
    };
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    return new Promise((resolve, reject) => {
      try {
        this.server = new WebSocket.Server({
          port: this.config.port,
          host: this.config.host,
          path: this.config.path,
          maxPayload: this.config.maxMessageSize,
          verifyClient: this.config.verifyClient,
        });

        this.server.on('listening', () => {
          this.connected = true;
          this.emitConnect();
          resolve();
        });

        this.server.on('connection', (ws: WebSocket, req) => {
          this.handleConnection(ws, req);
        });

        this.server.on('error', (error: Error) => {
          this.emitError(new TransportConnectionError('websocket', 'Server error', error));
          if (!this.connected) {
            reject(error);
          }
        });
      } catch (error) {
        reject(new TransportConnectionError('websocket', 'Failed to create WebSocket server', error as Error));
      }
    });
  }

  private handleConnection(ws: WebSocket, req: any): void {
    this.clients.add(ws);

    ws.on('message', (data: Buffer | string) => {
      this.handleMessage(data, ws);
    });

    ws.on('close', () => {
      this.clients.delete(ws);
    });

    ws.on('error', (error: Error) => {
      this.emitError(new TransportConnectionError('websocket', 'Client error', error));
    });
  }

  private handleMessage(data: Buffer | string, ws: WebSocket): void {
    try {
      const message = JSON.parse(data.toString()) as MCPMessage;

      if (this.messageResolvers.length > 0) {
        const resolver = this.messageResolvers.shift()!;
        resolver({ value: message, done: false });
      } else {
        this.messageQueue.push(message);
      }
    } catch (error) {
      this.emitError(new TransportError('websocket', `Failed to parse message: ${error}`, error as Error));
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;

    for (const client of this.clients) {
      client.close(1001, 'Server shutting down');
    }
    this.clients.clear();

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }

    this.connected = false;
    this.emitDisconnect();
  }

  async send(message: MCPMessage): Promise<void> {
    if (!this.connected) {
      throw new TransportConnectionError('websocket', 'Server not listening');
    }

    const data = JSON.stringify(message);

    // Broadcast to all connected clients
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
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

  isConnected(): boolean {
    return this.connected;
  }

  isConnecting(): boolean {
    return false;
  }

  getConnectedClients(): number {
    return this.clients.size;
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

export function createWebSocketTransport(config: WebSocketTransportConfig): WebSocketTransport {
  return new WebSocketTransport(config);
}

export function createWebSocketServerTransport(config: WebSocketServerTransportConfig): WebSocketServerTransport {
  return new WebSocketServerTransport(config);
}
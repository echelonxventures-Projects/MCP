/**
 * @mcp/transports - gRPC Transport Implementation
 * High-performance transport for service mesh environments
 */

import { EventEmitter } from 'events';
import {
  Transport,
  TransportType,
  TransportConfig,
  TransportCapabilities,
  GrpcTransportConfig,
  TransportError,
  TransportConnectionError,
  MCPMessage,
} from '@mcp/types';

// ============================================================================
// gRPC Transport (Client)
// ============================================================================

export class GrpcTransport extends EventEmitter implements Transport {
  public readonly type: TransportType = 'grpc';
  public readonly capabilities: TransportCapabilities;

  private config: GrpcTransportConfig;
  private client: any = null; // grpc.Client
  private connected = false;
  private connecting = false;
  private messageQueue: MCPMessage[] = [];
  private messageResolvers: Array<(value: IteratorResult<MCPMessage>) => void> = [];

  // Lifecycle hooks
  onConnect?: () => void;
  onDisconnect?: (error?: Error) => void;
  onError?: (error: Error) => void;

  constructor(config: GrpcTransportConfig) {
    super();

    this.config = config;
    this.capabilities = {
      streaming: true,
      bidirectional: true,
      maxMessageSize: config.maxMessageSize || 4 * 1024 * 1024, // 4MB default for gRPC
    };
  }

  async connect(): Promise<void> {
    if (this.connected || this.connecting) return;
    this.connecting = true;

    try {
      // Dynamic import to avoid requiring grpc as a hard dependency
      const grpc = await import('@grpc/grpc-js');
      const protoLoader = await import('@grpc/proto-loader');

      // Load proto definition
      // In a real implementation, this would load the MCP protobuf definition
      const packageDefinition = protoLoader.loadSync(this.config.protoPath || '', {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      });

      const proto = grpc.loadPackageDefinition(packageDefinition);
      const MCPService = proto.mcp.MCPService;

      // Create client
      const credentials = this.config.credentials || grpc.credentials.createInsecure();
      this.client = new MCPService(this.config.target, credentials);

      // Set up streaming call for bidirectional communication
      const call = this.client.streamMessages();

      call.on('data', (message: any) => {
        this.handleMessage(message);
      });

      call.on('error', (error: Error) => {
        this.emitError(new TransportConnectionError('grpc', 'Stream error', error));
      });

      call.on('end', () => {
        this.handleDisconnect();
      });

      this.connected = true;
      this.connecting = false;
      this.emitConnect();
    } catch (error) {
      this.connecting = false;
      throw new TransportConnectionError('grpc', 'Failed to connect', error as Error);
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;

    if (this.client) {
      // Close the client
      this.client.close();
      this.client = null;
    }

    this.handleDisconnect();
  }

  async send(message: MCPMessage): Promise<void> {
    if (!this.connected || !this.client) {
      throw new TransportConnectionError('grpc', 'Not connected');
    }

    // Convert MCPMessage to protobuf format
    const protoMessage = this.toProtoMessage(message);

    return new Promise((resolve, reject) => {
      this.client.sendMessage(protoMessage, (error: Error | null) => {
        if (error) {
          reject(new TransportConnectionError('grpc', error.message, error));
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

  private handleMessage(protoMessage: any): void {
    try {
      const message = this.fromProtoMessage(protoMessage);

      if (this.messageResolvers.length > 0) {
        const resolver = this.messageResolvers.shift()!;
        resolver({ value: message, done: false });
      } else {
        this.messageQueue.push(message);
      }
    } catch (error) {
      this.emitError(new TransportError('grpc', `Failed to parse message: ${error}`, error as Error));
    }
  }

  private handleDisconnect(error?: Error): void {
    this.connected = false;
    this.connecting = false;
    this.emitDisconnect(error);
  }

  private toProtoMessage(message: MCPMessage): any {
    // Convert MCPMessage to protobuf format
    return {
      jsonrpc: message.jsonrpc,
      id: message.id ? String(message.id) : '',
      method: message.method || '',
      params: message.params ? JSON.stringify(message.params) : '',
      result: message.result ? JSON.stringify(message.result) : '',
      error: message.error ? JSON.stringify(message.error) : '',
    };
  }

  private fromProtoMessage(protoMessage: any): MCPMessage {
    // Convert protobuf to MCPMessage
    return {
      jsonrpc: protoMessage.jsonrpc || '2.0',
      id: protoMessage.id || undefined,
      method: protoMessage.method || undefined,
      params: protoMessage.params ? JSON.parse(protoMessage.params) : undefined,
      result: protoMessage.result ? JSON.parse(protoMessage.result) : undefined,
      error: protoMessage.error ? JSON.parse(protoMessage.error) : undefined,
    };
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
// gRPC Transport (Server)
// ============================================================================

export interface GrpcServerTransportConfig {
  port: number;
  host?: string;
  protoPath: string;
  credentials?: any;
  maxMessageSize?: number;
}

export class GrpcServerTransport extends EventEmitter implements Transport {
  public readonly type: TransportType = 'grpc';
  public readonly capabilities: TransportCapabilities;

  private config: GrpcServerTransportConfig;
  private server: any = null; // grpc.Server
  private connected = false;
  private messageQueue: MCPMessage[] = [];
  private messageResolvers: Array<(value: IteratorResult<MCPMessage>) => void> = [];
  private activeCalls = new Set<any>();

  // Lifecycle hooks
  onConnect?: () => void;
  onDisconnect?: (error?: Error) => void;
  onError?: (error: Error) => void;

  constructor(config: GrpcServerTransportConfig) {
    super();

    this.config = config;
    this.capabilities = {
      streaming: true,
      bidirectional: true,
      maxMessageSize: config.maxMessageSize || 4 * 1024 * 1024,
    };
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    try {
      const grpc = await import('@grpc/grpc-js');
      const protoLoader = await import('@grpc/proto-loader');

      const packageDefinition = protoLoader.loadSync(this.config.protoPath, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      });

      const proto = grpc.loadPackageDefinition(packageDefinition);
      const MCPService = proto.mcp.MCPService;

      this.server = new grpc.Server();

      this.server.addService(MCPService.service, {
        streamMessages: this.handleStreamMessages.bind(this),
        sendMessage: this.handleSendMessage.bind(this),
      });

      const credentials = this.config.credentials || grpc.ServerCredentials.createInsecure();
      const bindAddress = `${this.config.host || '0.0.0.0'}:${this.config.port}`;

      await new Promise<void>((resolve, reject) => {
        this.server.bindAsync(bindAddress, credentials, (error: Error | null, port: number) => {
          if (error) {
            reject(error);
          } else {
            this.server.start();
            this.connected = true;
            this.emitConnect();
            resolve();
          }
        });
      });
    } catch (error) {
      throw new TransportConnectionError('grpc', 'Failed to start server', error as Error);
    }
  }

  private handleStreamMessages(call: any): void {
    this.activeCalls.add(call);

    call.on('data', (message: any) => {
      this.handleIncomingMessage(message, call);
    });

    call.on('end', () => {
      this.activeCalls.delete(call);
    });

    call.on('error', (error: Error) => {
      this.activeCalls.delete(call);
      this.emitError(new TransportConnectionError('grpc', 'Stream error', error));
    });
  }

  private handleSendMessage(call: any, callback: any): void {
    const message = call.request;
    this.handleIncomingMessage(message, null, callback);
  }

  private handleIncomingMessage(protoMessage: any, call: any | null, callback?: any): void {
    try {
      const message = this.fromProtoMessage(protoMessage);

      if (this.messageResolvers.length > 0) {
        const resolver = this.messageResolvers.shift()!;
        resolver({ value: message, done: false });
      } else {
        this.messageQueue.push(message);
      }

      if (callback) {
        callback(null, { accepted: true });
      }
    } catch (error) {
      this.emitError(new TransportError('grpc', `Failed to parse message: ${error}`, error as Error));
      if (callback) {
        callback(error);
      }
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;

    // Close all active calls
    for (const call of this.activeCalls) {
      call.end();
    }
    this.activeCalls.clear();

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server.tryShutdown(() => resolve());
      });
      this.server = null;
    }

    this.connected = false;
    this.emitDisconnect();
  }

  async send(message: MCPMessage): Promise<void> {
    if (!this.connected) {
      throw new TransportConnectionError('grpc', 'Server not listening');
    }

    // Broadcast to all active streaming calls
    const protoMessage = this.toProtoMessage(message);
    for (const call of this.activeCalls) {
      call.write(protoMessage);
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

  private toProtoMessage(message: MCPMessage): any {
    return {
      jsonrpc: message.jsonrpc,
      id: message.id ? String(message.id) : '',
      method: message.method || '',
      params: message.params ? JSON.stringify(message.params) : '',
      result: message.result ? JSON.stringify(message.result) : '',
      error: message.error ? JSON.stringify(message.error) : '',
    };
  }

  private fromProtoMessage(protoMessage: any): MCPMessage {
    return {
      jsonrpc: protoMessage.jsonrpc || '2.0',
      id: protoMessage.id || undefined,
      method: protoMessage.method || undefined,
      params: protoMessage.params ? JSON.parse(protoMessage.params) : undefined,
      result: protoMessage.result ? JSON.parse(protoMessage.result) : undefined,
      error: protoMessage.error ? JSON.parse(protoMessage.error) : undefined,
    };
  }

  isConnected(): boolean {
    return this.connected;
  }

  isConnecting(): boolean {
    return false;
  }

  getActiveCalls(): number {
    return this.activeCalls.size;
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

export function createGrpcClientTransport(config: GrpcTransportConfig): GrpcTransport {
  return new GrpcTransport(config);
}

export function createGrpcServerTransport(config: GrpcServerTransportConfig): GrpcServerTransport {
  return new GrpcServerTransport(config);
}
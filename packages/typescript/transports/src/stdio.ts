/**
 * @mcp/transports - Stdio Transport Implementation
 * Standard input/output transport for local development and CLI tools
 */

import { EventEmitter } from 'events';
import {
  Transport,
  TransportType,
  TransportConfig,
  TransportCapabilities,
  StdioTransportConfig,
  TransportError,
  TransportConnectionError,
  MCPMessage,
} from '@mcp/types';

// ============================================================================
// Stdio Transport Implementation
// ============================================================================

export class StdioTransport extends EventEmitter implements Transport {
  public readonly type: TransportType = 'stdio';
  public readonly capabilities: TransportCapabilities;

  private readStream: NodeJS.ReadableStream;
  private writeStream: NodeJS.WritableStream;
  private buffer = '';
  private connected = false;
  private connecting = false;
  private messageQueue: MCPMessage[] = [];
  private messageResolvers: Array<(value: IteratorResult<MCPMessage>) => void> = [];

  // Lifecycle hooks
  onConnect?: () => void;
  onDisconnect?: (error?: Error) => void;
  onError?: (error: Error) => void;

  constructor(config: StdioTransportConfig = {}) {
    super();

    this.capabilities = {
      streaming: true,
      bidirectional: true,
      maxMessageSize: config.maxMessageSize || 10 * 1024 * 1024, // 10MB
    };

    this.readStream = config.stdin || process.stdin;
    this.writeStream = config.stdout || process.stdout;

    this.setupStdio();
  }

  private setupStdio(): void {
    // Set encoding
    this.readStream.setEncoding('utf-8');

    // Handle incoming data
    this.readStream.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.processBuffer();
    });

    // Handle stream end
    this.readStream.on('end', () => {
      this.emitDisconnect();
    });

    // Handle stream errors
    this.readStream.on('error', (error: Error) => {
      this.emitError(new TransportConnectionError('stdio', error.message, error));
    });

    // Handle write stream errors
    this.writeStream.on('error', (error: Error) => {
      this.emitError(new TransportConnectionError('stdio', `Write stream error: ${error.message}`, error));
    });
  }

  private processBuffer(): void {
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (line) {
        try {
          const message = JSON.parse(line) as MCPMessage;
          this.emitMessage(message);
        } catch (error) {
          this.emitError(new TransportError('stdio', `Failed to parse message: ${error}`, error as Error));
        }
      }
    }
  }

  private emitMessage(message: MCPMessage): void {
    if (this.messageResolvers.length > 0) {
      const resolver = this.messageResolvers.shift()!;
      resolver({ value: message, done: false });
    } else {
      this.messageQueue.push(message);
    }
  }

  async connect(): Promise<void> {
    if (this.connected || this.connecting) return;
    this.connecting = true;

    // Stdio is always "connected" if streams exist
    // Just verify streams are available
    if (!this.readStream || !this.writeStream) {
      this.connecting = false;
      throw new TransportConnectionError('stdio', 'Standard input/output streams not available');
    }

    this.connected = true;
    this.connecting = false;
    this.emitConnect();
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;

    this.readStream.destroy();
    this.writeStream.end();
    this.emitDisconnect();
  }

  async send(message: MCPMessage): Promise<void> {
    if (!this.connected) {
      throw new TransportConnectionError('stdio', 'Not connected');
    }

    const line = JSON.stringify(message) + '\n';

    return new Promise((resolve, reject) => {
      this.writeStream.write(line, 'utf-8', (error) => {
        if (error) {
          reject(new TransportConnectionError('stdio', error.message, error));
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
    this.connected = false;
    this.connecting = false;
    this.emit('disconnect', error);
    this.onDisconnect?.(error);
  }

  private emitError(error: Error): void {
    this.emit('error', error);
    this.onError?.(error);
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createStdioTransport(config: StdioTransportConfig = {}): StdioTransport {
  return new StdioTransport(config);
}
/**
 * @mcp/transports - HTTP/SSE Transport Implementation
 * Server-Sent Events transport for serverless and webhook scenarios
 */

import { EventEmitter } from 'events';
import { createServer, IncomingMessage, ServerResponse, Server } from 'http';
import { parse } from 'url';
import {
  Transport,
  TransportType,
  TransportConfig,
  TransportCapabilities,
  HttpSseTransportConfig,
  TransportError,
  TransportConnectionError,
  MCPMessage,
} from '@mcp/types';

// ============================================================================
// SSE Connection Handler
// ============================================================================

interface SSEConnection {
  response: ServerResponse;
  clientId: string;
  connected: boolean;
  lastEventId?: string;
}

class SSEConnectionManager extends EventEmitter {
  private connections = new Map<string, SSEConnection>();
  private messageQueue: { clientId: string; message: MCPMessage }[] = [];
  private messageResolvers = new Map<string, Array<(value: IteratorResult<MCPMessage>) => void>>();

  addConnection(clientId: string, response: ServerResponse): void {
    const conn: SSEConnection = {
      response,
      clientId,
      connected: true,
    };

    // Send initial connection event
    this.writeSSE(response, 'open', { clientId, timestamp: new Date().toISOString() });

    // Flush queued messages for this client
    this.flushQueue(clientId);

    this.connections.set(clientId, conn);
    this.emit('connect', clientId);
  }

  removeConnection(clientId: string): void {
    const conn = this.connections.get(clientId);
    if (conn) {
      conn.connected = false;
      this.connections.delete(clientId);
      this.emit('disconnect', clientId);
    }
  }

  broadcast(message: MCPMessage): void {
    for (const [clientId, conn] of this.connections) {
      if (conn.connected) {
        this.sendToClient(clientId, message);
      }
    }
  }

  sendToClient(clientId: string, message: MCPMessage): boolean {
    const conn = this.connections.get(clientId);
    if (!conn || !conn.connected) {
      // Queue for later
      this.messageQueue.push({ clientId, message });
      return false;
    }

    this.writeSSE(conn.response, 'message', message);
    return true;
  }

  private flushQueue(clientId: string): void {
    const queued = this.messageQueue.filter(m => m.clientId === clientId);
    this.messageQueue = this.messageQueue.filter(m => m.clientId !== clientId);

    for (const { message } of queued) {
      this.sendToClient(clientId, message);
    }
  }

  private writeSSE(response: ServerResponse, event: string, data: any): void {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    response.write(`event: ${event}\n`);
    response.write(`data: ${payload}\n\n`);
  }

  createMessageIterator(clientId: string): AsyncIterable<MCPMessage> {
    const resolvers = this.messageResolvers.get(clientId) || [];
    this.messageResolvers.set(clientId, resolvers);

    return {
      [Symbol.asyncIterator](): AsyncIterator<MCPMessage> {
        return {
          next: () => new Promise<IteratorResult<MCPMessage>>((resolve) => {
            resolvers.push(resolve);
          }),
        };
      },
    };
  }

  handleIncomingMessage(clientId: string, message: MCPMessage): void {
    const resolvers = this.messageResolvers.get(clientId);
    if (resolvers && resolvers.length > 0) {
      const resolver = resolvers.shift()!;
      resolver({ value: message, done: false });
    } else {
      // No waiter, could queue or drop
      this.emit('message', clientId, message);
    }
  }

  getConnectedClients(): string[] {
    return Array.from(this.connections.keys()).filter(
      id => this.connections.get(id)?.connected
    );
  }
}

// ============================================================================
// HTTP/SSE Client Transport
// ============================================================================

export class HttpSseClientTransport extends EventEmitter implements Transport {
  public readonly type: TransportType = 'http-sse';
  public readonly capabilities: TransportCapabilities;

  private baseUrl: string;
  private headers: Record<string, string>;
  private eventSource: EventSource | null = null;
  private messageQueue: MCPMessage[] = [];
  private messageResolvers: Array<(value: IteratorResult<MCPMessage>) => void> = [];
  private fetchImpl: typeof fetch;
  private connected = false;
  private connecting = false;
  private clientId: string;

  // Lifecycle hooks
  onConnect?: () => void;
  onDisconnect?: (error?: Error) => void;
  onError?: (error: Error) => void;

  constructor(config: HttpSseTransportConfig) {
    super();

    this.capabilities = {
      streaming: true,
      bidirectional: false, // SSE is server->client only
      maxMessageSize: config.maxMessageSize || 10 * 1024 * 1024,
    };

    this.baseUrl = config.baseUrl;
    this.headers = config.headers || {};
    this.fetchImpl = config.fetch || fetch;
    this.clientId = `client-${Math.random().toString(36).slice(2)}`;
  }

  async connect(): Promise<void> {
    if (this.connected || this.connecting) return;
    this.connecting = true;

    // Create EventSource for SSE
    // Note: In Node.js, we'd use a polyfill like 'eventsource' package
    // For now, we'll simulate with polling or use native EventSource in browsers
    if (typeof EventSource !== 'undefined') {
      this.eventSource = new EventSource(`${this.baseUrl}/events`, {
        // @ts-ignore - EventSource polyfill options
        fetch: this.fetchImpl,
        headers: this.headers,
      });

      this.eventSource.onopen = () => {
        this.connected = true;
        this.connecting = false;
        this.emitConnect();
      };

      this.eventSource.onerror = (event) => {
        this.emitError(new TransportConnectionError('http-sse', 'SSE connection error', undefined, { event }));
        this.handleDisconnect();
      };

      this.eventSource.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      // Listen for typed events
      ['message', 'notification', 'response', 'error'].forEach(type => {
        this.eventSource!.addEventListener(type, (event: MessageEvent) => {
          this.handleMessage(event.data);
        });
      });
    } else {
      // Node.js fallback - use polling
      this.startPolling();
    }
  }

  private startPolling(): void {
    // Simplified polling implementation
    this.connected = true;
    this.connecting = false;
    this.emitConnect();

    // In a real implementation, this would poll the server
    // For now, we just mark as connected
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data) as MCPMessage;
      if (this.messageResolvers.length > 0) {
        const resolver = this.messageResolvers.shift()!;
        resolver({ value: message, done: false });
      } else {
        this.messageQueue.push(message);
      }
    } catch (error) {
      this.emitError(new TransportError('http-sse', `Failed to parse message: ${error}`, error as Error));
    }
  }

  async disconnect(): Promise<void> {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.handleDisconnect();
  }

  private handleDisconnect(): void {
    this.connected = false;
    this.connecting = false;
    this.emitDisconnect();
  }

  async send(message: MCPMessage): Promise<void> {
    const response = await this.fetchImpl(`${this.baseUrl}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-ID': this.clientId,
        ...this.headers,
      },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      throw new TransportError('http-sse', `HTTP ${response.status}: ${response.statusText}`);
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
// HTTP/SSE Server Transport
// ============================================================================

export class HttpSseServerTransport extends EventEmitter implements Transport {
  public readonly type: TransportType = 'http-sse';
  public readonly capabilities: TransportCapabilities;

  private server: Server | null = null;
  private config: HttpSseTransportConfig & { port: number; path?: string };
  private connections: SSEConnectionManager;
  private messageQueue: MCPMessage[] = [];
  private messageResolvers: Array<(value: IteratorResult<MCPMessage>) => void> = [];
  private connected = false;

  // Lifecycle hooks
  onConnect?: () => void;
  onDisconnect?: (error?: Error) => void;
  onError?: (error: Error) => void;

  constructor(config: HttpSseTransportConfig & { port: number; path?: string }) {
    super();

    this.config = {
      path: '/mcp',
      ...config,
    } as any;

    this.capabilities = {
      streaming: true,
      bidirectional: false,
      maxMessageSize: config.maxMessageSize || 10 * 1024 * 1024,
    };

    this.connections = new SSEConnectionManager();

    // Handle incoming messages from clients
    this.connections.on('message', (clientId: string, message: MCPMessage) => {
      if (this.messageResolvers.length > 0) {
        const resolver = this.messageResolvers.shift()!;
        resolver({ value: message, done: false });
      } else {
        this.messageQueue.push(message);
      }
    });
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    return new Promise((resolve, reject) => {
      this.server = createServer(async (req, res) => {
        await this.handleRequest(req, res);
      });

      this.server.on('error', (error: Error) => {
        this.emitError(new TransportConnectionError('http-sse', 'Server error', error));
        if (!this.connected) {
          reject(error);
        }
      });

      this.server.listen(this.config.port, () => {
        this.connected = true;
        this.emitConnect();
        resolve();
      });
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = parse(req.url || '', true);
    const path = url.pathname || '';

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Last-Event-ID');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // SSE endpoint
    if (path === `${this.config.path}/events` && req.method === 'GET') {
      await this.handleSSE(req, res);
      return;
    }

    // Message endpoint
    if (path === `${this.config.path}/message` && req.method === 'POST') {
      await this.handleMessage(req, res);
      return;
    }

    // Health check
    if (path === `${this.config.path}/health` && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', connections: this.connections.getConnectedClients().length }));
      return;
    }

    // Not found
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  private async handleSSE(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    });

    // Generate client ID
    const clientId = req.headers['x-client-id'] as string || `client-${Math.random().toString(36).slice(2)}`;

    // Handle Last-Event-ID for reconnection
    const lastEventId = req.headers['last-event-id'] as string;

    // Add connection
    this.connections.addConnection(clientId, res);

    // Handle client disconnect
    req.on('close', () => {
      this.connections.removeConnection(clientId);
    });

    // Send any missed events (simplified)
    if (lastEventId) {
      // In real implementation, fetch and replay missed events
      res.write(`: reconnect after ${lastEventId}\n\n`);
    }
  }

  private async handleMessage(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > this.capabilities.maxMessageSize) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Message too large' }));
        req.destroy();
      }
    });

    req.on('end', () => {
      try {
        const message = JSON.parse(body) as MCPMessage;

        // Get client ID from header
        const clientId = req.headers['x-client-id'] as string;

        // Forward to message handlers
        if (clientId) {
          this.connections.handleIncomingMessage(clientId, message);
        } else {
          // Broadcast to all
          this.messageQueue.push(message);
          if (this.messageResolvers.length > 0) {
            const resolver = this.messageResolvers.shift()!;
            resolver({ value: message, done: false });
          }
        }

        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ accepted: true }));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;

    // Close all SSE connections
    for (const clientId of this.connections.getConnectedClients()) {
      this.connections.removeConnection(clientId);
    }

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
      throw new TransportConnectionError('http-sse', 'Server not listening');
    }

    // Broadcast to all connected clients
    this.connections.broadcast(message);
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
    return this.connections.getConnectedClients().length;
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

export function createHttpSseClientTransport(config: HttpSseTransportConfig): HttpSseClientTransport {
  return new HttpSseClientTransport(config);
}

export function createHttpSseServerTransport(config: HttpSseTransportConfig & { port: number; path?: string }): HttpSseServerTransport {
  return new HttpSseServerTransport(config);
}
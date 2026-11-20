/**
 * @mcp/server - MCP Server Framework
 * TypeScript-first implementation with middleware pipeline, capability registration, and transport abstraction
 */

import { EventEmitter } from 'events';
import {
  MCPMessage,
  MCPError,
  Tool,
  Resource,
  Prompt,
  ServerCapabilities,
  ClientCapabilities,
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
  isRequest,
  isNotification,
  isResponse,
  isErrorResponse,
  createMCPError,
  ERROR_CODES,
} from '@mcp/types';

import { Transport, TransportConfig, TransportType, createTransport } from '@mcp/transports';

// ============================================================================
// Type Definitions
// ============================================================================

export interface ToolDefinition<InputSchema extends JSONSchema = JSONSchema> {
  name: string;
  description: string;
  inputSchema: InputSchema;
  outputSchema?: JSONSchema;
  annotations?: ToolAnnotations;
  handler: ToolHandler<InputSchema>;
}

export type ToolHandler<InputSchema extends JSONSchema = JSONSchema> = (
  args: InputSchema extends { properties: infer P } ? P : Record<string, unknown>,
  context: ToolContext
) => Promise<CallToolResult>;

export interface ToolContext {
  requestId: string | number;
  clientInfo: ClientCapabilities;
  serverInfo: ServerInfo;
  signal: AbortSignal;
}

export interface ResourceDefinition {
  uriPattern: string;
  name: string;
  description?: string;
  mimeType?: string;
  annotations?: ResourceAnnotations;
  handler: ResourceHandler;
}

export type ResourceHandler = (
  uri: ParsedUri,
  context: ResourceContext
) => Promise<ReadResourceResult>;

export interface ParsedUri {
  href: string;
  pattern: string;
  params: Record<string, string>;
}

export interface ResourceContext {
  requestId: string | number;
  clientInfo: ClientCapabilities;
}

export interface PromptDefinition {
  name: string;
  description?: string;
  arguments?: PromptArgument[];
  handler: PromptHandler;
}

export type PromptHandler = (
  args: Record<string, unknown>,
  context: PromptContext
) => Promise<GetPromptResult>;

export interface PromptContext {
  requestId: string | number;
  clientInfo: ClientCapabilities;
}

export interface ServerInfo {
  name: string;
  version: string;
  capabilities: ServerCapabilities;
}

export interface ServerStartConfig {
  transport: TransportType | TransportConfig | Transport;
  port?: number;
  host?: string;
  stdio?: boolean;
}

export interface MiddlewareContext {
  requestId: string | number;
  method: string;
  params?: unknown;
  clientCapabilities: ClientCapabilities;
  serverCapabilities: ServerCapabilities;
  transport: Transport;
  startTime: number;
}

export type NextFn = () => Promise<void>;

export interface ServerMiddleware {
  // Request/response interception
  onRequest?: (ctx: MiddlewareContext, next: NextFn) => Promise<void>;
  onResponse?: (ctx: MiddlewareContext, next: NextFn) => Promise<void>;
  onError?: (ctx: MiddlewareContext, error: Error, next: NextFn) => Promise<void>;

  // Connection lifecycle
  onConnect?: (ctx: ConnectionContext) => Promise<void>;
  onDisconnect?: (ctx: ConnectionContext, error?: Error) => Promise<void>;
}

export interface ConnectionContext {
  connectionId: string;
  transport: Transport;
  clientCapabilities?: ClientCapabilities;
  serverCapabilities: ServerCapabilities;
  metadata: Record<string, unknown>;
}

export interface RequestContext extends MiddlewareContext {
  message: MCPMessage;
}

export interface ResponseContext extends MiddlewareContext {
  message: MCPMessage;
  response: MCPMessage;
}

export interface ErrorContext extends MiddlewareContext {
  error: Error;
}

// ============================================================================
// Server Implementation
// ============================================================================

export class McpServer extends EventEmitter {
  private tools = new Map<string, ToolDefinition>();
  private resources = new Map<string, ResourceDefinition>();
  private prompts = new Map<string, PromptDefinition>();
  private middlewares: ServerMiddleware[] = [];
  private transport: Transport | null = null;
  private serverInfo: ServerInfo;
  private connections = new Map<string, ConnectionContext>();
  private connectionCounter = 0;
  private initialized = false;
  private clientCapabilities: ClientCapabilities | null = null;

  constructor(config: {
    name: string;
    version: string;
    capabilities?: ServerCapabilities;
  }) {
    super();
    this.serverInfo = {
      name: config.name,
      version: config.version,
      capabilities: config.capabilities || {},
    };
  }

  // ---------------------------------------------------------------------------
  // Capability Registration
  // ---------------------------------------------------------------------------

  tool<InputSchema extends JSONSchema = JSONSchema>(
    def: ToolDefinition<InputSchema>
  ): this {
    if (this.tools.has(def.name)) {
      throw new Error(`Tool already registered: ${def.name}`);
    }
    this.tools.set(def.name, def);
    this.emit('toolRegistered', def);
    return this;
  }

  resource(def: ResourceDefinition): this {
    if (this.resources.has(def.uriPattern)) {
      throw new Error(`Resource already registered: ${def.uriPattern}`);
    }
    this.resources.set(def.uriPattern, def);
    this.emit('resourceRegistered', def);
    return this;
  }

  prompt(def: PromptDefinition): this {
    if (this.prompts.has(def.name)) {
      throw new Error(`Prompt already registered: ${def.name}`);
    }
    this.prompts.set(def.name, def);
    this.emit('promptRegistered', def);
    return this;
  }

  // ---------------------------------------------------------------------------
  // Middleware Pipeline
  // ---------------------------------------------------------------------------

  use(middleware: ServerMiddleware): this {
    this.middlewares.push(middleware);
    return this;
  }

  // ---------------------------------------------------------------------------
  // Transport & Lifecycle
  // ---------------------------------------------------------------------------

  async start(config: ServerStartConfig): Promise<void> {
    if (this.transport) {
      throw new Error('Server already started');
    }

    // Create transport
    if (config.transport instanceof Transport) {
      this.transport = config.transport;
    } else if (typeof config.transport === 'string') {
      this.transport = createTransport({ type: config.transport, port: config.port, host: config.host });
    } else {
      this.transport = createTransport(config.transport);
    }

    // Set up transport event handlers
    this.transport.onConnect = () => this.handleConnect();
    this.transport.onDisconnect = (error) => this.handleDisconnect(error);
    this.transport.onError = (error) => this.handleTransportError(error);

    // Connect transport
    await this.transport.connect();

    // Start message loop
    this.startMessageLoop();

    this.emit('started', { transport: this.transport.type });
  }

  async stop(): Promise<void> {
    if (!this.transport) {
      return;
    }

    // Close all connections
    for (const [id, ctx] of this.connections) {
      await this.closeConnection(id, new Error('Server stopping'));
    }

    await this.transport.disconnect();
    this.transport = null;
    this.initialized = false;
    this.clientCapabilities = null;

    this.emit('stopped');
  }

  // ---------------------------------------------------------------------------
  // Message Handling
  // ---------------------------------------------------------------------------

  private async startMessageLoop(): Promise<void> {
    if (!this.transport) return;

    for await (const message of this.transport.receive()) {
      await this.handleMessage(message);
    }
  }

  private async handleMessage(message: MCPMessage): Promise<void> {
    const ctx: RequestContext = {
      requestId: message.id ?? Date.now(),
      method: message.method ?? '',
      params: message.params,
      clientCapabilities: this.clientCapabilities || {},
      serverCapabilities: this.serverInfo.capabilities,
      transport: this.transport!,
      startTime: Date.now(),
      message,
    };

    try {
      // Run request middleware
      await this.runRequestMiddleware(ctx);

      // Handle the message
      const response = await this.dispatchMessage(message);

      // Run response middleware
      const responseCtx: ResponseContext = { ...ctx, response };
      await this.runResponseMiddleware(responseCtx);

      // Send response
      if (response && this.transport) {
        await this.transport.send(response);
      }
    } catch (error) {
      await this.handleError(ctx, error as Error);
    }
  }

  private async dispatchMessage(message: MCPMessage): Promise<MCPMessage | null> {
    // Handle notifications (no response expected)
    if (isNotification(message)) {
      await this.handleNotification(message);
      return null;
    }

    // Handle requests
    if (isRequest(message)) {
      return await this.handleRequest(message);
    }

    // Handle responses (for client-side, but we're server)
    if (isResponse(message)) {
      this.emit('response', message);
      return null;
    }

    // Unknown message type
    return createMCPError(
      message.id ?? null,
      ERROR_CODES.INVALID_REQUEST,
      `Unknown message type`
    );
  }

  private async handleNotification(message: MCPMessage): Promise<void> {
    switch (message.method) {
      case 'initialized':
        this.initialized = true;
        this.emit('initialized');
        break;
      case 'cancelled':
        this.emit('cancelled', message.params);
        break;
      default:
        this.emit('notification', message);
    }
  }

  private async handleRequest(message: MCPMessage): Promise<MCPMessage> {
    const { method, params, id } = message;

    try {
      switch (method) {
        case 'initialize':
          return await this.handleInitialize(params as { protocolVersion: string; capabilities: ClientCapabilities; clientInfo: { name: string; version: string } }, id);
        case 'tools/list':
          return this.createResponse(id, await this.handleListTools());
        case 'tools/call':
          return this.createResponse(id, await this.handleCallTool(params as { name: string; arguments?: Record<string, unknown> }));
        case 'resources/list':
          return this.createResponse(id, await this.handleListResources(params as { cursor?: string } | undefined));
        case 'resources/read':
          return this.createResponse(id, await this.handleReadResource(params as { uri: string }));
        case 'resources/subscribe':
          return this.createResponse(id, await this.handleSubscribeResource(params as { uri: string }));
        case 'resources/unsubscribe':
          return this.createResponse(id, await this.handleUnsubscribeResource(params as { uri: string }));
        case 'prompts/list':
          return this.createResponse(id, await this.handleListPrompts(params as { cursor?: string } | undefined));
        case 'prompts/get':
          return this.createResponse(id, await this.handleGetPrompt(params as { name: string; arguments?: Record<string, unknown> }));
        case 'ping':
          return this.createResponse(id, {});
        default:
          // Check for custom method handlers
          const customHandler = this.listeners(`method:${method}`)[0];
          if (customHandler) {
            return this.createResponse(id, await customHandler(params));
          }
          throw createMCPError(id, ERROR_CODES.METHOD_NOT_FOUND, `Method not found: ${method}`);
      }
    } catch (error) {
      if (isErrorResponse(error)) {
        return error;
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Protocol Method Handlers
  // ---------------------------------------------------------------------------

  private async handleInitialize(
    params: { protocolVersion: string; capabilities: ClientCapabilities; clientInfo: { name: string; version: string } },
    id: string | number | undefined
  ): Promise<MCPMessage> {
    this.clientCapabilities = params.capabilities;
    this.initialized = true;

    return this.createResponse(id, {
      protocolVersion: '1.0',
      capabilities: this.serverInfo.capabilities,
      serverInfo: {
        name: this.serverInfo.name,
        version: this.serverInfo.version,
      },
    });
  }

  private async handleListTools(): Promise<ListToolsResult> {
    const tools: Tool[] = Array.from(this.tools.values()).map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      outputSchema: t.outputSchema,
      annotations: t.annotations,
    }));
    return { tools };
  }

  private async handleCallTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<CallToolResult> {
    const tool = this.tools.get(params.name);
    if (!tool) {
      throw createMCPError(
        undefined,
        ERROR_CODES.TOOL_NOT_FOUND,
        `Tool not found: ${params.name}`
      );
    }

    const context: ToolContext = {
      requestId: Date.now(),
      clientInfo: this.clientCapabilities || {},
      serverInfo: this.serverInfo,
      signal: AbortSignal.none,
    };

    try {
      const result = await tool.handler(params.arguments || {}, context);
      return result;
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Tool error: ${(error as Error).message}` }],
        isError: true,
      };
    }
  }

  private async handleListResources(params?: { cursor?: string }): Promise<ListResourcesResult> {
    const resources: Resource[] = Array.from(this.resources.values()).map(r => ({
      uri: r.uriPattern,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
      annotations: r.annotations,
    }));

    // Simple pagination (in real implementation, use cursor)
    return { resources, nextCursor: undefined };
  }

  private async handleReadResource(params: { uri: string }): Promise<ReadResourceResult> {
    // Find matching resource pattern
    for (const [pattern, resource] of this.resources) {
      const parsed = this.parseUri(pattern, params.uri);
      if (parsed) {
        const context: ResourceContext = {
          requestId: Date.now(),
          clientInfo: this.clientCapabilities || {},
        };
        const result = await resource.handler(parsed, context);
        return result;
      }
    }

    throw createMCPError(
      undefined,
      ERROR_CODES.RESOURCE_NOT_FOUND,
      `Resource not found: ${params.uri}`
    );
  }

  private async handleSubscribeResource(params: { uri: string }): Promise<{ subscribed: boolean }> {
    // In a real implementation, track subscriptions per connection
    return { subscribed: true };
  }

  private async handleUnsubscribeResource(params: { uri: string }): Promise<{ unsubscribed: boolean }> {
    return { unsubscribed: true };
  }

  private async handleListPrompts(params?: { cursor?: string }): Promise<ListPromptsResult> {
    const prompts: Prompt[] = Array.from(this.prompts.values()).map(p => ({
      name: p.name,
      description: p.description,
      arguments: p.arguments,
    }));
    return { prompts, nextCursor: undefined };
  }

  private async handleGetPrompt(params: { name: string; arguments?: Record<string, unknown> }): Promise<GetPromptResult> {
    const prompt = this.prompts.get(params.name);
    if (!prompt) {
      throw createMCPError(
        undefined,
        ERROR_CODES.PROMPT_NOT_FOUND,
        `Prompt not found: ${params.name}`
      );
    }

    const context: PromptContext = {
      requestId: Date.now(),
      clientInfo: this.clientCapabilities || {},
    };

    return await prompt.handler(params.arguments || {}, context);
  }

  // ---------------------------------------------------------------------------
  // Connection Management
  // ---------------------------------------------------------------------------

  private handleConnect(): void {
    const connectionId = `conn-${++this.connectionCounter}`;
    const ctx: ConnectionContext = {
      connectionId,
      transport: this.transport!,
      serverCapabilities: this.serverInfo.capabilities,
      metadata: {},
    };
    this.connections.set(connectionId, ctx);

    // Run connect middleware
    this.runConnectMiddleware(ctx).catch(err => this.emit('error', err));

    this.emit('connect', ctx);
  }

  private handleDisconnect(error?: Error): void {
    for (const [id, ctx] of this.connections) {
      this.runDisconnectMiddleware(ctx, error).catch(err => this.emit('error', err));
      this.connections.delete(id);
      this.emit('disconnect', { connectionId: id, error });
    }
  }

  private handleTransportError(error: Error): void {
    this.emit('error', error);
  }

  private async closeConnection(connectionId: string, error: Error): Promise<void> {
    const ctx = this.connections.get(connectionId);
    if (ctx) {
      await this.runDisconnectMiddleware(ctx, error);
      this.connections.delete(connectionId);
    }
  }

  // ---------------------------------------------------------------------------
  // Middleware Execution
  // ---------------------------------------------------------------------------

  private async runRequestMiddleware(ctx: RequestContext): Promise<void> {
    let index = 0;
    const next = async (): Promise<void> => {
      if (index < this.middlewares.length) {
        const middleware = this.middlewares[index++];
        if (middleware.onRequest) {
          await middleware.onRequest(ctx, next);
        } else {
          await next();
        }
      }
    };
    await next();
  }

  private async runResponseMiddleware(ctx: ResponseContext): Promise<void> {
    let index = this.middlewares.length - 1;
    const next = async (): Promise<void> => {
      if (index >= 0) {
        const middleware = this.middlewares[index--];
        if (middleware.onResponse) {
          await middleware.onResponse(ctx, next);
        } else {
          await next();
        }
      }
    };
    await next();
  }

  private async runConnectMiddleware(ctx: ConnectionContext): Promise<void> {
    for (const middleware of this.middlewares) {
      if (middleware.onConnect) {
        await middleware.onConnect(ctx);
      }
    }
  }

  private async runDisconnectMiddleware(ctx: ConnectionContext, error?: Error): Promise<void> {
    for (const middleware of this.middlewares) {
      if (middleware.onDisconnect) {
        await middleware.onDisconnect(ctx, error);
      }
    }
  }

  private async handleError(ctx: RequestContext, error: Error): Promise<void> {
    const errorCtx: ErrorContext = { ...ctx, error };
    let index = this.middlewares.length - 1;

    const next = async (): Promise<void> => {
      if (index >= 0) {
        const middleware = this.middlewares[index--];
        if (middleware.onError) {
          await middleware.onError(errorCtx, next);
        } else {
          await next();
        }
      }
    };

    await next();

    // Send error response
    const errorResponse = createMCPError(
      ctx.requestId,
      ERROR_CODES.INTERNAL_ERROR,
      error.message
    );

    if (this.transport) {
      await this.transport.send(errorResponse);
    }
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  private parseUri(pattern: string, uri: string): ParsedUri | null {
    // Convert pattern like "resource://{id}" to regex
    const regexPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\{([^}]+)\}/g, '(?<$1>[^/]+)');
    const regex = new RegExp(`^${regexPattern}$`);
    const match = uri.match(regex);

    if (!match) return null;

    const params: Record<string, string> = {};
    if (match.groups) {
      Object.assign(params, match.groups);
    }

    return { href: uri, pattern, params };
  }

  private createResponse(id: string | number | undefined, result: unknown): MCPMessage {
    return {
      jsonrpc: '2.0',
      id,
      result,
    };
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  getTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  getResources(): ResourceDefinition[] {
    return Array.from(this.resources.values());
  }

  getPrompts(): PromptDefinition[] {
    return Array.from(this.prompts.values());
  }

  getServerInfo(): ServerInfo {
    return { ...this.serverInfo };
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getConnectionCount(): number {
    return this.connections.size;
  }

  // Allow registering custom method handlers
  onMethod(method: string, handler: (params: unknown) => Promise<unknown>): this {
    this.on(`method:${method}`, handler);
    return this;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

export function tool<InputSchema extends JSONSchema = JSONSchema>(
  name: string,
  description: string,
  inputSchema: InputSchema,
  handler: ToolHandler<InputSchema>
): ToolDefinition<InputSchema> {
  return { name, description, inputSchema, handler };
}

export function resource(
  uriPattern: string,
  name: string,
  handler: ResourceHandler,
  options?: { description?: string; mimeType?: string; annotations?: ResourceAnnotations }
): ResourceDefinition {
  return { uriPattern, name, handler, ...options };
}

export function prompt(
  name: string,
  handler: PromptHandler,
  options?: { description?: string; arguments?: PromptArgument[] }
): PromptDefinition {
  return { name, handler, ...options };
}
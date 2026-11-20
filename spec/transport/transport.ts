/**
 * Transport Abstraction Specification
 *
 * A unified interface for different transport mechanisms (stdio, HTTP/SSE, WebSocket, gRPC, custom)
 * designed for MCP (Model Context Protocol) and general client-server communication.
 *
 * @packageDocumentation
 */

// ============================================================================
// Transport Type Enumeration
// ============================================================================

/**
 * Supported transport types
 */
export enum TransportType {
  /** Standard input/output transport (stdio) */
  STDIO = 'stdio',
  /** HTTP Server-Sent Events transport */
  HTTP_SSE = 'http-sse',
  /** WebSocket transport */
  WEBSOCKET = 'websocket',
  /** gRPC transport */
  GRPC = 'grpc',
  /** Custom/extensible transport */
  CUSTOM = 'custom',
}

// ============================================================================
// Transport Capabilities
// ============================================================================

/**
 * Transport capability flags describing what features a transport supports
 */
export interface TransportCapabilities {
  /** Supports streaming responses (server-sent events, chunked responses) */
  streaming: boolean;
  /** Supports bidirectional communication (both send and receive concurrently) */
  bidirectional: boolean;
  /** Maximum message size in bytes (0 = unlimited) */
  maxMessageSize: number;
  /** Supported compression algorithms */
  compression: CompressionAlgorithm[];
  /** Supported authentication mechanisms */
  auth: AuthMechanism[];
  /** Whether the transport supports automatic reconnection */
  reconnection: boolean;
  /** Whether the transport supports message ordering guarantees */
  ordered: boolean;
  /** Whether the transport supports message acknowledgments */
  acknowledgments: boolean;
  /** Custom capability extensions */
  extensions: Record<string, unknown>;
}

/**
 * Supported compression algorithms
 */
export type CompressionAlgorithm =
  | 'none'
  | 'gzip'
  | 'deflate'
  | 'brotli'
  | 'zstd'
  | string;

/**
 * Supported authentication mechanisms
 */
export type AuthMechanism =
  | 'none'
  | 'bearer'
  | 'api-key'
  | 'basic'
  | 'oauth2'
  | 'mtls'
  | 'custom'
  | string;

// ============================================================================
// Transport Configuration
// ============================================================================

/**
 * Base configuration shared by all transports
 */
export interface TransportConfig {
  /** Transport type identifier */
  type: TransportType;
  /** Human-readable name for this transport instance */
  name?: string;
  /** Connection timeout in milliseconds */
  connectTimeout?: number;
  /** Operation timeout in milliseconds (send/receive) */
  operationTimeout?: number;
  /** Maximum number of retry attempts for failed operations */
  maxRetries?: number;
  /** Retry delay base in milliseconds (exponential backoff) */
  retryDelay?: number;
  /** Enable debug logging */
  debug?: boolean;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Stdio transport configuration
 */
export interface StdioTransportConfig extends TransportConfig {
  type: TransportType.STDIO;
  /** Command to execute for stdio transport */
  command: string;
  /** Command arguments */
  args?: string[];
  /** Working directory for the command */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Input encoding */
  inputEncoding?: BufferEncoding;
  /** Output encoding */
  outputEncoding?: BufferEncoding;
}

/**
 * HTTP/SSE transport configuration
 */
export interface HttpSseTransportConfig extends TransportConfig {
  type: TransportType.HTTP_SSE;
  /** Base URL for the HTTP endpoint */
  baseUrl: string;
  /** SSE endpoint path */
  ssePath?: string;
  /** POST endpoint path for sending messages */
  postPath?: string;
  /** HTTP headers */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds */
  requestTimeout?: number;
  /** Whether to use fetch with keep-alive */
  keepAlive?: boolean;
  /** Custom fetch implementation */
  fetch?: typeof fetch;
}

/**
 * WebSocket transport configuration
 */
export interface WebSocketTransportConfig extends TransportConfig {
  type: TransportType.WEBSOCKET;
  /** WebSocket server URL */
  url: string;
  /** WebSocket subprotocols */
  protocols?: string[];
  /** Connection headers */
  headers?: Record<string, string>;
  /** Heartbeat interval in milliseconds */
  heartbeatInterval?: number;
  /** Heartbeat timeout in milliseconds */
  heartbeatTimeout?: number;
  /** Maximum message size in bytes */
  maxMessageSize?: number;
  /** Whether to enable permessage-deflate compression */
  perMessageDeflate?: boolean;
  /** Custom WebSocket implementation */
  WebSocket?: typeof WebSocket;
}

/**
 * gRPC transport configuration
 */
export interface GrpcTransportConfig extends TransportConfig {
  type: TransportType.GRPC;
  /** gRPC service target (host:port) */
  target: string;
  /** Service definition (protobuf service name) */
  serviceName: string;
  /** Package name */
  packageName?: string;
  /** TLS credentials */
  credentials?: GrpcCredentials;
  /** Channel options */
  channelOptions?: Record<string, unknown>;
  /** Default call options */
  callOptions?: Record<string, unknown>;
}

/**
 * gRPC credentials configuration
 */
export interface GrpcCredentials {
  /** Use insecure credentials (no TLS) */
  insecure?: boolean;
  /** Root certificates for TLS */
  rootCerts?: Buffer;
  /** Private key for mTLS */
  privateKey?: Buffer;
  /** Certificate chain for mTLS */
  certChain?: Buffer;
  /** Custom credentials factory */
  custom?: unknown;
}

/**
 * Custom transport configuration
 */
export interface CustomTransportConfig extends TransportConfig {
  type: TransportType.CUSTOM;
  /** Custom transport factory function name or identifier */
  factory: string;
  /** Custom configuration options */
  options?: Record<string, unknown>;
}

/**
 * Union of all transport configurations
 */
export type TransportConfigUnion =
  | StdioTransportConfig
  | HttpSseTransportConfig
  | WebSocketTransportConfig
  | GrpcTransportConfig
  | CustomTransportConfig;

// ============================================================================
// Transport Messages
// ============================================================================

/**
 * Base message envelope
 */
export interface TransportMessage<T = unknown> {
  /** Unique message ID */
  id: string;
  /** Message type */
  type: string;
  /** Message payload */
  payload: T;
  /** Message timestamp (Unix ms) */
  timestamp: number;
  /** Correlation ID for request/response matching */
  correlationId?: string;
  /** Message headers */
  headers?: Record<string, string>;
  /** Message priority (higher = more important) */
  priority?: number;
}

/**
 * Request message
 */
export interface RequestMessage<T = unknown> extends TransportMessage<T> {
  type: 'request';
  /** Method name */
  method: string;
  /** Request parameters */
  params?: T;
}

/**
 * Response message
 */
export interface ResponseMessage<T = unknown> extends TransportMessage<T> {
  type: 'response';
  /** Request ID this responds to */
  requestId: string;
  /** Response result */
  result?: T;
  /** Response error */
  error?: TransportErrorInfo;
}

/**
 * Notification message (one-way)
 */
export interface NotificationMessage<T = unknown> extends TransportMessage<T> {
  type: 'notification';
  /** Notification method */
  method: string;
  /** Notification parameters */
  params?: T;
}

/**
 * Stream chunk message
 */
export interface StreamChunkMessage<T = unknown> extends TransportMessage<T> {
  type: 'stream-chunk';
  /** Stream ID */
  streamId: string;
  /** Whether this is the final chunk */
  isFinal: boolean;
  /** Chunk sequence number */
  sequence: number;
  /** Chunk data */
  data: T;
}

/**
 * Error info structure
 */
export interface TransportErrorInfo {
  /** Error code */
  code: string;
  /** Human-readable error message */
  message: string;
  /** Additional error data */
  data?: unknown;
}

/**
 * Union of all message types
 */
export type TransportMessageUnion =
  | RequestMessage
  | ResponseMessage
  | NotificationMessage
  | StreamChunkMessage;

// ============================================================================
// Transport Events
// ============================================================================

/**
 * Transport lifecycle events
 */
export interface TransportEvents {
  /** Emitted when transport connects successfully */
  connect: (info: ConnectionInfo) => void;
  /** Emitted when transport disconnects */
  disconnect: (info: DisconnectionInfo) => void;
  /** Emitted when an error occurs */
  error: (error: TransportError) => void;
  /** Emitted when a message is received */
  message: (message: TransportMessageUnion) => void;
  /** Emitted when a message is sent */
  sent: (message: TransportMessageUnion) => void;
  /** Emitted when reconnection is attempted */
  reconnecting: (attempt: number, maxAttempts: number) => void;
  /** Emitted when reconnection succeeds */
  reconnected: (info: ConnectionInfo) => void;
  /** Emitted when reconnection fails permanently */
  reconnectFailed: (error: TransportError) => void;
}

/**
 * Connection information
 */
export interface ConnectionInfo {
  /** Transport type */
  transportType: TransportType;
  /** Remote endpoint identifier */
  remoteAddress?: string;
  /** Local endpoint identifier */
  localAddress?: string;
  /** Connection establishment timestamp */
  connectedAt: number;
  /** Negotiated capabilities */
  capabilities: TransportCapabilities;
  /** Protocol version */
  protocolVersion?: string;
}

/**
 * Disconnection information
 */
export interface DisconnectionInfo {
  /** Whether disconnection was intentional */
  graceful: boolean;
  /** Disconnect reason */
  reason?: string;
  /** Error if disconnection was due to error */
  error?: TransportError;
  /** Disconnection timestamp */
  disconnectedAt: number;
  /** Duration of connection in milliseconds */
  duration: number;
}

/**
 * Event handler type
 */
export type TransportEventHandler<K extends keyof TransportEvents> = TransportEvents[K];

// ============================================================================
// Transport Errors
// ============================================================================

/**
 * Base transport error class
 */
export class TransportError extends Error {
  public readonly code: string;
  public readonly transportType: TransportType;
  public readonly recoverable: boolean;
  public readonly cause?: Error;
  public readonly metadata?: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    transportType: TransportType,
    options: {
      recoverable?: boolean;
      cause?: Error;
      metadata?: Record<string, unknown>;
    } = {}
  ) {
    super(message);
    this.name = 'TransportError';
    this.code = code;
    this.transportType = transportType;
    this.recoverable = options.recoverable ?? false;
    this.cause = options.cause;
    this.metadata = options.metadata;

    // Maintains proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TransportError);
    }
  }

  /** Check if error is a specific code */
  is(code: string): boolean {
    return this.code === code;
  }

  /** Check if error is recoverable */
  isRecoverable(): boolean {
    return this.recoverable;
  }

  /** Convert to plain object for serialization */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      transportType: this.transportType,
      recoverable: this.recoverable,
      cause: this.cause?.message,
      metadata: this.metadata,
      stack: this.stack,
    };
  }
}

/**
 * Connection-specific errors
 */
export class ConnectionError extends TransportError {
  public readonly phase: 'connecting' | 'connected' | 'disconnecting' | 'reconnecting';

  constructor(
    message: string,
    transportType: TransportType,
    phase: ConnectionError['phase'],
    options: {
      recoverable?: boolean;
      cause?: Error;
      metadata?: Record<string, unknown>;
    } = {}
  ) {
    super(message, 'CONNECTION_ERROR', transportType, { ...options, recoverable: options.recoverable ?? true });
    this.name = 'ConnectionError';
    this.phase = phase;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ConnectionError);
    }
  }
}

/**
 * Protocol-specific errors
 */
export class ProtocolError extends TransportError {
  public readonly protocolPhase: 'handshake' | 'message' | 'stream' | 'heartbeat' | 'close';
  public readonly expected?: string;
  public readonly received?: string;

  constructor(
    message: string,
    transportType: TransportType,
    protocolPhase: ProtocolError['protocolPhase'],
    options: {
      recoverable?: boolean;
      cause?: Error;
      metadata?: Record<string, unknown>;
      expected?: string;
      received?: string;
    } = {}
  ) {
    super(message, 'PROTOCOL_ERROR', transportType, { ...options, recoverable: options.recoverable ?? false });
    this.name = 'ProtocolError';
    this.protocolPhase = protocolPhase;
    this.expected = options.expected;
    this.received = options.received;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ProtocolError);
    }
  }
}

/**
 * Timeout error
 */
export class TimeoutError extends TransportError {
  public readonly operation: 'connect' | 'send' | 'receive' | 'heartbeat' | 'close';
  public readonly timeout: number;

  constructor(
    message: string,
    transportType: TransportType,
    operation: TimeoutError['operation'],
    timeout: number,
    options: {
      recoverable?: boolean;
      cause?: Error;
      metadata?: Record<string, unknown>;
    } = {}
  ) {
    super(message, 'TIMEOUT_ERROR', transportType, { ...options, recoverable: options.recoverable ?? true });
    this.name = 'TimeoutError';
    this.operation = operation;
    this.timeout = timeout;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TimeoutError);
    }
  }
}

/**
 * Error codes
 */
export const TransportErrorCodes = {
  // Connection errors
  CONNECTION_REFUSED: 'CONNECTION_REFUSED',
  CONNECTION_RESET: 'CONNECTION_RESET',
  CONNECTION_TIMEOUT: 'CONNECTION_TIMEOUT',
  CONNECTION_CLOSED: 'CONNECTION_CLOSED',
  TLS_HANDSHAKE_FAILED: 'TLS_HANDSHAKE_FAILED',

  // Protocol errors
  PROTOCOL_VERSION_MISMATCH: 'PROTOCOL_VERSION_MISMATCH',
  INVALID_MESSAGE_FORMAT: 'INVALID_MESSAGE_FORMAT',
  UNEXPECTED_MESSAGE: 'UNEXPECTED_MESSAGE',
  MESSAGE_TOO_LARGE: 'MESSAGE_TOO_LARGE',
  STREAM_ERROR: 'STREAM_ERROR',

  // Operation errors
  SEND_FAILED: 'SEND_FAILED',
  RECEIVE_FAILED: 'RECEIVE_FAILED',
  OPERATION_TIMEOUT: 'OPERATION_TIMEOUT',
  OPERATION_CANCELLED: 'OPERATION_CANCELLED',

  // Authentication/Authorization
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  AUTH_FAILED: 'AUTH_FAILED',
  AUTH_EXPIRED: 'AUTH_EXPIRED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',

  // Resource errors
  RESOURCE_EXHAUSTED: 'RESOURCE_EXHAUSTED',
  RATE_LIMITED: 'RATE_LIMITED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',

  // Internal errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
} as const;

// ============================================================================
// Transport Interface
// ============================================================================

/**
 * Transport interface defining the contract for all transport implementations
 */
export interface Transport {
  /** Transport type */
  readonly type: TransportType;
  /** Transport capabilities */
  readonly capabilities: TransportCapabilities;
  /** Current connection state */
  readonly state: TransportState;
  /** Transport configuration */
  readonly config: TransportConfigUnion;

  /**
   * Establish connection
   * @throws {ConnectionError} If connection fails
   */
  connect(): Promise<void>;

  /**
   * Gracefully disconnect
   * @throws {ConnectionError} If disconnection fails
   */
  disconnect(): Promise<void>;

  /**
   * Send a message
   * @param message - Message to send
   * @throws {TransportError} If send fails
   */
  send(message: TransportMessageUnion): Promise<void>;

  /**
   * Receive messages as an async iterable
   * @returns AsyncIterable that yields received messages
   * @throws {TransportError} If receive fails
   */
  receive(): AsyncIterable<TransportMessageUnion>;

  /**
   * Register an event handler
   * @param event - Event name
   * @param handler - Event handler function
   * @returns Function to unregister the handler
   */
  on<K extends keyof TransportEvents>(event: K, handler: TransportEventHandler<K>): () => void;

  /**
   * Register a one-time event handler
   * @param event - Event name
   * @param handler - Event handler function
   * @returns Function to unregister the handler
   */
  once<K extends keyof TransportEvents>(event: K, handler: TransportEventHandler<K>): () => void;

  /**
   * Remove an event handler
   * @param event - Event name
   * @param handler - Event handler function
   */
  off<K extends keyof TransportEvents>(event: K, handler: TransportEventHandler<K>): void;

  /**
   * Get current connection info
   */
  getConnectionInfo(): ConnectionInfo | null;

  /**
   * Check if transport is healthy
   */
  isHealthy(): boolean;

  /**
   * Force close without graceful shutdown
   */
  destroy(): Promise<void>;
}

/**
 * Transport connection states
 */
export type TransportState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'reconnecting'
  | 'failed'
  | 'destroyed';

// ============================================================================
// Transport Factory
// ============================================================================

/**
 * Transport factory function type
 */
export type TransportFactory = (config: TransportConfigUnion) => Transport;

/**
 * Transport registry for custom transports
 */
export interface TransportRegistry {
  /** Register a custom transport factory */
  register(type: TransportType.CUSTOM, factory: TransportFactory): void;
  /** Get a transport factory by type */
  get(type: TransportType): TransportFactory | undefined;
  /** List all registered transport types */
  list(): TransportType[];
}

/**
 * Default transport registry instance
 */
export const defaultTransportRegistry: TransportRegistry = {
  _factories: new Map<TransportType, TransportFactory>(),

  register(type: TransportType.CUSTOM, factory: TransportFactory): void {
    this._factories.set(type, factory);
  },

  get(type: TransportType): TransportFactory | undefined {
    return this._factories.get(type);
  },

  list(): TransportType[] {
    return Array.from(this._factories.keys());
  },
};

/**
 * Create a transport instance from configuration
 *
 * @param config - Transport configuration
 * @param registry - Optional custom registry (uses default if not provided)
 * @returns Transport instance
 * @throws {ConfigurationError} If transport type is unknown or config is invalid
 */
export function createTransport(
  config: TransportConfigUnion,
  registry: TransportRegistry = defaultTransportRegistry
): Transport {
  const factory = registry.get(config.type);

  if (!factory) {
    throw new TransportError(
      `Unknown transport type: ${config.type}`,
      TransportErrorCodes.CONFIGURATION_ERROR,
      config.type,
      { recoverable: false, metadata: { config } }
    );
  }

  return factory(config);
}

/**
 * Built-in transport factories (to be implemented by transport providers)
 */
export const builtinTransportFactories: Record<Exclude<TransportType, TransportType.CUSTOM>, TransportFactory> = {
  [TransportType.STDIO]: (config) => {
    throw new TransportError(
      'STDIO transport not implemented - provide a custom factory',
      TransportErrorCodes.NOT_IMPLEMENTED,
      TransportType.STDIO,
      { recoverable: false }
    );
  },
  [TransportType.HTTP_SSE]: (config) => {
    throw new TransportError(
      'HTTP/SSE transport not implemented - provide a custom factory',
      TransportErrorCodes.NOT_IMPLEMENTED,
      TransportType.HTTP_SSE,
      { recoverable: false }
    );
  },
  [TransportType.WEBSOCKET]: (config) => {
    throw new TransportError(
      'WebSocket transport not implemented - provide a custom factory',
      TransportErrorCodes.NOT_IMPLEMENTED,
      TransportType.WEBSOCKET,
      { recoverable: false }
    );
  },
  [TransportType.GRPC]: (config) => {
    throw new TransportError(
      'gRPC transport not implemented - provide a custom factory',
      TransportErrorCodes.NOT_IMPLEMENTED,
      TransportType.GRPC,
      { recoverable: false }
    );
  },
};

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Extract message payload type
 */
export type MessagePayload<T extends TransportMessageUnion> = T extends TransportMessage<infer P> ? P : never;

/**
 * Extract request payload type
 */
export type RequestPayload<T extends RequestMessage> = T extends RequestMessage<infer P> ? P : never;

/**
 * Extract response payload type
 */
export type ResponsePayload<T extends ResponseMessage> = T extends ResponseMessage<infer P> ? P : never;

/**
 * Message handler function type
 */
export type MessageHandler<T extends TransportMessageUnion = TransportMessageUnion> = (
  message: T
) => Promise<void> | void;

/**
 * Request handler function type
 */
export type RequestHandler<TReq extends RequestMessage = RequestMessage, TRes extends ResponseMessage = ResponseMessage> = (
  request: TReq
) => Promise<TRes> | TRes;

/**
 * Transport middleware function type
 */
export type TransportMiddleware = (
  message: TransportMessageUnion,
  next: () => Promise<void>
) => Promise<void>;

// ============================================================================
// Transport Builder (Fluent API)
// ============================================================================

/**
 * Fluent builder for transport configuration
 */
export class TransportConfigBuilder<T extends TransportConfigUnion = TransportConfigUnion> {
  private config: Partial<T>;

  constructor(type: TransportType) {
    this.config = { type } as Partial<T>;
  }

  /** Set transport name */
  name(name: string): this {
    this.config.name = name;
    return this;
  }

  /** Set connection timeout */
  connectTimeout(ms: number): this {
    this.config.connectTimeout = ms;
    return this;
  }

  /** Set operation timeout */
  operationTimeout(ms: number): this {
    this.config.operationTimeout = ms;
    return this;
  }

  /** Set max retries */
  maxRetries(n: number): this {
    this.config.maxRetries = n;
    return this;
  }

  /** Set retry delay */
  retryDelay(ms: number): this {
    this.config.retryDelay = ms;
    return this;
  }

  /** Enable debug mode */
  debug(enabled = true): this {
    this.config.debug = enabled;
    return this;
  }

  /** Set metadata */
  metadata(meta: Record<string, unknown>): this {
    this.config.metadata = meta;
    return this;
  }

  /** Build the configuration */
  build(): T {
    return this.config as T;
  }
}

/**
 * Create a transport config builder
 */
export function createTransportConfig(type: TransportType.Stdio): TransportConfigBuilder<StdioTransportConfig>;
export function createTransportConfig(type: TransportType.HttpSse): TransportConfigBuilder<HttpSseTransportConfig>;
export function createTransportConfig(type: TransportType.WebSocket): TransportConfigBuilder<WebSocketTransportConfig>;
export function createTransportConfig(type: TransportType.Grpc): TransportConfigBuilder<GrpcTransportConfig>;
export function createTransportConfig(type: TransportType.Custom): TransportConfigBuilder<CustomTransportConfig>;
export function createTransportConfig(type: TransportType): TransportConfigBuilder<TransportConfigUnion>;
export function createTransportConfig(type: TransportType): TransportConfigBuilder<TransportConfigUnion> {
  return new TransportConfigBuilder(type);
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export type {
  TransportConfig as BaseTransportConfig,
  TransportMessage as BaseTransportMessage,
  TransportEvents as BaseTransportEvents,
  TransportError as BaseTransportError,
  ConnectionInfo as BaseConnectionInfo,
  DisconnectionInfo as BaseDisconnectionInfo,
  TransportCapabilities as BaseTransportCapabilities,
};

export {
  TransportType,
  TransportError,
  ConnectionError,
  ProtocolError,
  TimeoutError,
  TransportErrorCodes,
  defaultTransportRegistry,
  createTransport,
  createTransportConfig,
  builtinTransportFactories,
};
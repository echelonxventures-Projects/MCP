/**
 * @mcp/transports - Transport Implementations for MCP
 * Main entry point exporting all transport types
 */

// Types
export * from './types';

// Base transport interface (re-export from types)
export type {
  Transport,
  TransportType,
  TransportConfig,
  TransportCapabilities,
  TransportEventMap,
  StdioTransportConfig,
  HttpSseTransportConfig,
  WebSocketTransportConfig,
  GrpcTransportConfig,
  CustomTransportConfig,
  TransportError,
  TransportConnectionError,
  TransportTimeoutError,
} from '@mcp/types';

// Factory function (re-export from types)
export { createTransport } from '@mcp/types';

// Stdio Transport
export { StdioTransport, createStdioTransport } from './stdio';

// WebSocket Transport
export {
  WebSocketTransport,
  WebSocketServerTransport,
  createWebSocketTransport,
  createWebSocketServerTransport
} from './websocket';

// HTTP/SSE Transport
export {
  HttpSseClientTransport,
  HttpSseServerTransport,
  createHttpSseClientTransport,
  createHttpSseServerTransport
} from './http-sse';

// gRPC Transport (placeholder)
export { GrpcTransport } from './grpc';

// Custom Transport
export { CustomTransport } from './custom';
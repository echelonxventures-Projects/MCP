/**
 * @mcp/types - TypeScript MCP Protocol Types
 * Re-exports all types from the protocol specification
 * Auto-generated from spec/protocol/mcp-core.ts
 */

// Core protocol types
export {
  // Message types
  MCPMessage,
  MCPError,
  MCPErrorCode,
  ERROR_CODES,
  createMCPError,
  isRequest,
  isNotification,
  isResponse,
  isErrorResponse,

  // Capability types
  ClientCapabilities,
  ServerCapabilities,
  ToolsCapability,
  ResourcesCapability,
  PromptsCapability,
  LoggingCapability,

  // Tool types
  Tool,
  ToolAnnotations,
  CallToolResult,
  CallToolRequest,
  ListToolsResult,
  ListToolsRequest,

  // Resource types
  Resource,
  ResourceAnnotations,
  ResourceContents,
  ReadResourceResult,
  ReadResourceRequest,
  ListResourcesResult,
  ListResourcesRequest,
  SubscribeRequest,
  UnsubscribeRequest,

  // Prompt types
  Prompt,
  PromptArgument,
  GetPromptResult,
  GetPromptRequest,
  ListPromptsResult,
  ListPromptsRequest,
  PromptMessage,
  PromptMessageContent,

  // Initialization
  InitializeRequest,
  InitializeResult,
  InitializeResponse,
  ClientInfo,
  ServerInfo,

  // Pagination
  PaginationParams,
  PaginatedResult,
  Cursor,

  // Logging
  LoggingLevel,
  SetLevelRequest,
  LoggingMessageNotification,

  // Completion
  CompleteRequest,
  CompleteResult,
  Completion,
  CompletionContext,

  // Roots
  Root,
  ListRootsResult,
  ListRootsRequest,

  // Sampling
  SamplingMessage,
  CreateMessageRequest,
  CreateMessageResult,
  ModelPreferences,
  ModelHint,

  // Progress
  ProgressNotification,
  ProgressParams,

  // Cancellation
  CancelledNotification,
  CancelRequest,

  // JSON Schema
  JSONSchema,

  // Branded types
  ServerId,
  ToolName,
  ResourceUri,
  PromptName,
  ConnectionId,
  RequestId,
  createServerId,
  createToolName,
  createResourceUri,
  createPromptName,
  createConnectionId,
  createRequestId,

  // Type guards
  isTool,
  isResource,
  isPrompt,
  isResourceContents,
  isMCPError,
  isInitializeRequest,
  isInitializeResult,
  isCallToolRequest,
  isCallToolResult,
  isReadResourceRequest,
  isReadResourceResult,
  isListToolsRequest,
  isListToolsResult,
  isListResourcesRequest,
  isListResourcesResult,
  isSubscribeRequest,
  isUnsubscribeRequest,
  isListPromptsRequest,
  isListPromptsResult,
  isGetPromptRequest,
  isGetPromptResult,
  isCompleteRequest,
  isCompleteResult,
  isListRootsRequest,
  isListRootsResult,
  isCreateMessageRequest,
  isCreateMessageResult,
  isProgressNotification,
  isCancelledNotification,
  isLoggingMessageNotification,
} from '../../spec/protocol/mcp-core';

// Zod validators (re-exported)
export {
  MCPMessageZod,
  MCPErrorZod,
  ClientCapabilitiesZod,
  ServerCapabilitiesZod,
  ToolZod,
  ToolAnnotationsZod,
  CallToolResultZod,
  ResourceZod,
  ResourceAnnotationsZod,
  ResourceContentsZod,
  ReadResourceResultZod,
  PromptZod,
  PromptArgumentZod,
  GetPromptResultZod,
  InitializeRequestZod,
  InitializeResultZod,
  PaginationParamsZod,
  LoggingLevelZod,
  CompleteRequestZod,
  CompleteResultZod,
  RootZod,
  SamplingMessageZod,
  CreateMessageRequestZod,
  CreateMessageResultZod,
  ProgressParamsZod,
  CancelledNotificationZod,
  JSONSchemaZod,
} from '../../spec/protocol/mcp-core';

// Transport types
export {
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
  createTransport,
} from '@mcp/transports';

// Registry types
export {
  CapabilityRegistry,
  ServerRegistration,
  RegistrationResult,
  DiscoveryCriteria,
  ServerInfo,
  ServerStatus,
  HealthInfo,
  HealthCheck,
  HealthEvent,
  RegistryConfig,
  HealthCheckConfig,
  CacheConfig,
  RegistryBackend,
} from '@mcp/registry';

// Server types
export {
  McpServer,
  ToolDefinition,
  ToolHandler,
  ToolContext,
  ResourceDefinition,
  ResourceHandler,
  ParsedUri,
  ResourceContext,
  PromptDefinition,
  PromptHandler,
  PromptContext,
  ServerInfo as ServerInfoType,
  ServerStartConfig,
  ServerMiddleware,
  ConnectionContext,
  RequestContext,
  ResponseContext,
  ErrorContext,
  tool,
  resource,
  prompt,
} from '@mcp/server';

// Client types
export {
  ConnectionManager,
  ConnectionConfig,
  RetryConfig,
  FailoverConfig,
  PoolConfig,
  Connection,
  ConnectionStatus,
  McpContext,
  McpClient,
  createConnectionManager,
  connectToServer,
} from '@mcp/client';

// Middleware types
export {
  auth,
  AuthConfig,
  AuthResult,
  rateLimit,
  RateLimitConfig,
  RateLimitStore,
  logging,
  LoggingConfig,
  tracing,
  TracingConfig,
  metrics,
  MetricsConfig,
  validation,
  ValidationConfig,
  ValidationResult,
  caching,
  CacheConfig,
  CacheStore,
  circuitBreaker,
  CircuitBreakerConfig,
  compression,
  CompressionConfig,
  requestId,
  cors,
  CorsConfig,
} from '@mcp/server/middleware';
/**
 * MCP (Model Context Protocol) Core Specification
 *
 * TypeScript-first protocol definition for MCP - the standard for connecting
 * LLMs to external tools, resources, and prompts.
 *
 * This file is the SINGLE SOURCE OF TRUTH for all MCP types.
 * Code generation pipeline reads this file to produce idiomatic bindings for:
 * - TypeScript (@mcp/types)
 * - Python (mcp-types)
 * - Go (github.com/mcp/go-sdk/types)
 * - Rust (mcp-types)
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// ============================================================================
// JSON Schema Types
// ============================================================================

/**
 * JSON Schema Draft 2020-12 compatible type
 * Used for tool input/output schemas and resource schemas
 */
export interface JSONSchema {
  type?: JSONSchemaType | JSONSchemaType[];
  title?: string;
  description?: string;
  default?: unknown;
  examples?: unknown[];
  multipleOf?: number;
  maximum?: number;
  exclusiveMaximum?: number | boolean;
  minimum?: number;
  exclusiveMinimum?: number | boolean;
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  format?: string;
  maxItems?: number;
  minItems?: number;
  uniqueItems?: boolean;
  items?: JSONSchema | JSONSchema[];
  maxProperties?: number;
  minProperties?: number;
  required?: string[];
  properties?: Record<string, JSONSchema>;
  patternProperties?: Record<string, JSONSchema>;
  additionalProperties?: boolean | JSONSchema;
  allOf?: JSONSchema[];
  anyOf?: JSONSchema[];
  oneOf?: JSONSchema[];
  not?: JSONSchema;
  $ref?: string;
  $defs?: Record<string, JSONSchema>;
  $schema?: string;
  const?: unknown;
  enum?: unknown[];
  discriminator?: Discriminator;
  externalDocs?: ExternalDocumentation;
  nullable?: boolean;
  readOnly?: boolean;
  writeOnly?: boolean;
  deprecated?: boolean;
  [key: string]: unknown;
}

export type JSONSchemaType =
  | 'null'
  | 'boolean'
  | 'object'
  | 'array'
  | 'number'
  | 'string'
  | 'integer';

export interface Discriminator {
  propertyName: string;
  mapping?: Record<string, string>;
}

export interface ExternalDocumentation {
  description?: string;
  url: string;
}

/**
 * Zod schema for JSONSchema validation
 */
export const JSONSchemaZod: z.ZodType<JSONSchema> = z.lazy(() =>
  z.record(z.unknown()).passthrough()
);

// ============================================================================
// Base Protocol Types
// ============================================================================

/**
 * JSON-RPC 2.0 Message Envelope
 * All MCP communication uses JSON-RPC 2.0 framing
 */
export interface MCPMessage {
  /** JSON-RPC version - always "2.0" */
  jsonrpc: '2.0';
  /** Request ID - omitted for notifications */
  id?: string | number;
  /** Method name for requests/notifications */
  method?: string;
  /** Method parameters */
  params?: unknown;
  /** Successful response result */
  result?: unknown;
  /** Error response */
  error?: MCPError;
}

/**
 * Zod validator for MCPMessage
 */
export const MCPMessageZod = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});

/**
 * MCP Error Structure (JSON-RPC 2.0 compatible)
 */
export interface MCPError {
  /** Error code (JSON-RPC standard codes + MCP extensions) */
  code: number;
  /** Human-readable error message */
  message: string;
  /** Additional error data */
  data?: unknown;
}

/**
 * Zod validator for MCPError
 */
export const MCPErrorZod = z.object({
  code: z.number().int(),
  message: z.string(),
  data: z.unknown().optional(),
});

/**
 * Standard JSON-RPC Error Codes
 */
export const JSON_RPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

/**
 * MCP-Specific Error Codes
 */
export const MCP_ERROR_CODES = {
  // Server errors (-32000 to -32099)
  SERVER_NOT_INITIALIZED: -32000,
  SERVER_ALREADY_INITIALIZED: -32001,
  INVALID_CAPABILITIES: -32002,
  TOOL_NOT_FOUND: -32010,
  TOOL_EXECUTION_FAILED: -32011,
  RESOURCE_NOT_FOUND: -32020,
  RESOURCE_ACCESS_DENIED: -32021,
  PROMPT_NOT_FOUND: -32030,
  PROMPT_RENDER_FAILED: -32031,
  INVALID_CURSOR: -32040,
  PAGINATION_ERROR: -32041,
} as const;

// ============================================================================
// Capability Negotiation
// ============================================================================

/**
 * Client Capabilities - what the client supports
 */
export interface ClientCapabilities {
  /** Tool calling capability */
  tools?: ToolsCapability;
  /** Resource access capability */
  resources?: ResourcesCapability;
  /** Prompt rendering capability */
  prompts?: PromptsCapability;
  /** Experimental capabilities */
  experimental?: Record<string, unknown>;
}

/**
 * Zod validator for ClientCapabilities
 */
export const ClientCapabilitiesZod = z.object({
  tools: z.unknown().optional(),
  resources: z.unknown().optional(),
  prompts: z.unknown().optional(),
  experimental: z.record(z.unknown()).optional(),
});

/**
 * Server Capabilities - what the server provides
 */
export interface ServerCapabilities {
  /** Tool calling capability */
  tools?: ToolsCapability;
  /** Resource access capability */
  resources?: ResourcesCapability;
  /** Prompt rendering capability */
  prompts?: PromptsCapability;
  /** Logging capability */
  logging?: LoggingCapability;
  /** Experimental capabilities */
  experimental?: Record<string, unknown>;
}

/**
 * Zod validator for ServerCapabilities
 */
export const ServerCapabilitiesZod = z.object({
  tools: z.unknown().optional(),
  resources: z.unknown().optional(),
  prompts: z.unknown().optional(),
  logging: z.unknown().optional(),
  experimental: z.record(z.unknown()).optional(),
});

// ============================================================================
// Tools
// ============================================================================

/**
 * Tool Annotations - metadata about tool behavior
 */
export interface ToolAnnotations {
  /** Tool is read-only (doesn't modify state) */
  readOnly?: boolean;
  /** Tool is idempotent (same input = same result) */
  idempotent?: boolean;
  /** Tool may have side effects */
  destructive?: boolean;
  /** Estimated execution time in milliseconds */
  estimatedDurationMs?: number;
  /** Required permissions/scopes */
  requiredPermissions?: string[];
  /** Custom annotations */
  [key: string]: unknown;
}

/**
 * Zod validator for ToolAnnotations
 */
export const ToolAnnotationsZod = z.object({
  readOnly: z.boolean().optional(),
  idempotent: z.boolean().optional(),
  destructive: z.boolean().optional(),
  estimatedDurationMs: z.number().int().nonnegative().optional(),
  requiredPermissions: z.array(z.string()).optional(),
}).passthrough();

/**
 * Tool Definition - a callable function exposed by the server
 */
export interface Tool {
  /** Unique tool name */
  name: string;
  /** Human-readable description */
  description: string;
  /** Input schema (JSON Schema) */
  inputSchema: JSONSchema;
  /** Output schema (JSON Schema) - optional */
  outputSchema?: JSONSchema;
  /** Tool behavior annotations */
  annotations?: ToolAnnotations;
}

/**
 * Zod validator for Tool
 */
export const ToolZod = z.object({
  name: z.string().min(1),
  description: z.string(),
  inputSchema: JSONSchemaZod,
  outputSchema: JSONSchemaZod.optional(),
  annotations: ToolAnnotationsZod.optional(),
});

/**
 * Tools Capability
 */
export interface ToolsCapability {
  /** Server supports list_changed notifications */
  listChanged?: boolean;
}

/**
 * Zod validator for ToolsCapability
 */
export const ToolsCapabilityZod = z.object({
  listChanged: z.boolean().optional(),
});

/**
 * Tool Call Request Parameters
 */
export interface CallToolParams {
  /** Tool name */
  name: string;
  /** Tool arguments */
  arguments: Record<string, unknown>;
}

/**
 * Zod validator for CallToolParams
 */
export const CallToolParamsZod = z.object({
  name: z.string().min(1),
  arguments: z.record(z.unknown()),
});

/**
 * Tool Call Result
 */
export interface CallToolResult {
  /** Result content */
  content: ToolResultContent[];
  /** Whether the result is an error */
  isError?: boolean;
  /** Structured result data (optional) */
  structuredContent?: unknown;
}

/**
 * Zod validator for CallToolResult
 */
export const CallToolResultZod = z.object({
  content: z.array(z.unknown()),
  isError: z.boolean().optional(),
  structuredContent: z.unknown().optional(),
});

/**
 * Tool Result Content Types
 */
export type ToolResultContent =
  | TextContent
  | ImageContent
  | AudioContent
  | ResourceLinkContent
  | EmbeddedResourceContent;

export interface TextContent {
  type: 'text';
  text: string;
  /** Optional annotations */
  annotations?: Record<string, unknown>;
}

export interface ImageContent {
  type: 'image';
  data: string; // base64 encoded
  mimeType: string;
  /** Optional annotations */
  annotations?: Record<string, unknown>;
}

export interface AudioContent {
  type: 'audio';
  data: string; // base64 encoded
  mimeType: string;
  /** Optional annotations */
  annotations?: Record<string, unknown>;
}

export interface ResourceLinkContent {
  type: 'resource_link';
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
  /** Optional annotations */
  annotations?: Record<string, unknown>;
}

export interface EmbeddedResourceContent {
  type: 'resource';
  resource: ResourceContents;
  /** Optional annotations */
  annotations?: Record<string, unknown>;
}

/**
 * Zod validators for content types
 */
export const TextContentZod = z.object({
  type: z.literal('text'),
  text: z.string(),
  annotations: z.record(z.unknown()).optional(),
});

export const ImageContentZod = z.object({
  type: z.literal('image'),
  data: z.string(),
  mimeType: z.string(),
  annotations: z.record(z.unknown()).optional(),
});

export const AudioContentZod = z.object({
  type: z.literal('audio'),
  data: z.string(),
  mimeType: z.string(),
  annotations: z.record(z.unknown()).optional(),
});

export const ResourceLinkContentZod = z.object({
  type: z.literal('resource_link'),
  uri: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
  annotations: z.record(z.unknown()).optional(),
});

export const EmbeddedResourceContentZod = z.object({
  type: z.literal('resource'),
  resource: z.unknown(),
  annotations: z.record(z.unknown()).optional(),
});

export const ToolResultContentZod = z.discriminatedUnion('type', [
  TextContentZod,
  ImageContentZod,
  AudioContentZod,
  ResourceLinkContentZod,
  EmbeddedResourceContentZod,
]);

// ============================================================================
// Resources
// ============================================================================

/**
 * Resource Annotations - metadata about resource
 */
export interface ResourceAnnotations {
  /** Resource is read-only */
  readOnly?: boolean;
  /** Resource size in bytes (if known) */
  size?: number;
  /** Last modified timestamp (Unix ms) */
  lastModified?: number;
  /** Custom annotations */
  [key: string]: unknown;
}

/**
 * Zod validator for ResourceAnnotations
 */
export const ResourceAnnotationsZod = z.object({
  readOnly: z.boolean().optional(),
  size: z.number().int().nonnegative().optional(),
  lastModified: z.number().int().nonnegative().optional(),
}).passthrough();

/**
 * Resource Definition - a readable data source
 */
export interface Resource {
  /** Resource URI (unique identifier) */
  uri: string;
  /** Human-readable name */
  name: string;
  /** Description */
  description?: string;
  /** MIME type */
  mimeType?: string;
  /** Resource annotations */
  annotations?: ResourceAnnotations;
}

/**
 * Zod validator for Resource
 */
export const ResourceZod = z.object({
  uri: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  mimeType: z.string().optional(),
  annotations: ResourceAnnotationsZod.optional(),
});

/**
 * Resources Capability
 */
export interface ResourcesCapability {
  /** Server supports subscribe/unsubscribe */
  subscribe?: boolean;
  /** Server supports list_changed notifications */
  listChanged?: boolean;
}

/**
 * Zod validator for ResourcesCapability
 */
export const ResourcesCapabilityZod = z.object({
  subscribe: z.boolean().optional(),
  listChanged: z.boolean().optional(),
});

/**
 * Resource Contents - actual resource data
 */
export interface ResourceContents {
  /** Resource URI */
  uri: string;
  /** MIME type */
  mimeType: string;
  /** Text content (for text resources) */
  text?: string;
  /** Binary content (base64 encoded) */
  blob?: string;
}

/**
 * Zod validator for ResourceContents
 */
export const ResourceContentsZod = z.object({
  uri: z.string().min(1),
  mimeType: z.string(),
  text: z.string().optional(),
  blob: z.string().optional(),
});

/**
 * Read Resource Parameters
 */
export interface ReadResourceParams {
  /** Resource URI */
  uri: string;
}

/**
 * Zod validator for ReadResourceParams
 */
export const ReadResourceParamsZod = z.object({
  uri: z.string().min(1),
});

/**
 * Resource Template - for dynamic resource discovery
 */
export interface ResourceTemplate {
  /** URI template (RFC 6570) */
  uriTemplate: string;
  /** Human-readable name */
  name: string;
  /** Description */
  description?: string;
  /** MIME type */
  mimeType?: string;
  /** Resource annotations */
  annotations?: ResourceAnnotations;
}

/**
 * Zod validator for ResourceTemplate
 */
export const ResourceTemplateZod = z.object({
  uriTemplate: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  mimeType: z.string().optional(),
  annotations: ResourceAnnotationsZod.optional(),
});

/**
 * Subscribe Resource Parameters
 */
export interface SubscribeResourceParams {
  /** Resource URI */
  uri: string;
}

/**
 * Zod validator for SubscribeResourceParams
 */
export const SubscribeResourceParamsZod = z.object({
  uri: z.string().min(1),
});

/**
 * Unsubscribe Resource Parameters
 */
export interface UnsubscribeResourceParams {
  /** Resource URI */
  uri: string;
}

/**
 * Zod validator for UnsubscribeResourceParams
 */
export const UnsubscribeResourceParamsZod = z.object({
  uri: z.string().min(1),
});

/**
 * Resource Updated Notification
 */
export interface ResourceUpdatedNotification {
  /** Resource URI */
  uri: string;
}

/**
 * Zod validator for ResourceUpdatedNotification
 */
export const ResourceUpdatedNotificationZod = z.object({
  uri: z.string().min(1),
});

// ============================================================================
// Prompts
// ============================================================================

/**
 * Prompt Argument Definition
 */
export interface PromptArgument {
  /** Argument name */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Whether argument is required */
  required?: boolean;
}

/**
 * Zod validator for PromptArgument
 */
export const PromptArgumentZod = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  required: z.boolean().optional(),
});

/**
 * Prompt Definition - a reusable prompt template
 */
export interface Prompt {
  /** Unique prompt name */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Prompt arguments */
  arguments?: PromptArgument[];
}

/**
 * Zod validator for Prompt
 */
export const PromptZod = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  arguments: z.array(PromptArgumentZod).optional(),
});

/**
 * Prompts Capability
 */
export interface PromptsCapability {
  /** Server supports list_changed notifications */
  listChanged?: boolean;
}

/**
 * Zod validator for PromptsCapability
 */
export const PromptsCapabilityZod = z.object({
  listChanged: z.boolean().optional(),
});

/**
 * Get Prompt Parameters
 */
export interface GetPromptParams {
  /** Prompt name */
  name: string;
  /** Prompt arguments */
  arguments?: Record<string, string>;
}

/**
 * Zod validator for GetPromptParams
 */
export const GetPromptParamsZod = z.object({
  name: z.string().min(1),
  arguments: z.record(z.string()).optional(),
});

/**
 * Prompt Message - a message in a prompt conversation
 */
export interface PromptMessage {
  /** Role */
  role: 'user' | 'assistant' | 'system';
  /** Message content */
  content: PromptMessageContent;
}

/**
 * Zod validator for PromptMessage
 */
export const PromptMessageZod = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.unknown(),
});

/**
 * Prompt Message Content Types
 */
export type PromptMessageContent =
  | TextPromptContent
  | ImagePromptContent
  | AudioPromptContent
  | ResourcePromptContent;

export interface TextPromptContent {
  type: 'text';
  text: string;
}

export interface ImagePromptContent {
  type: 'image';
  data: string; // base64
  mimeType: string;
}

export interface AudioPromptContent {
  type: 'audio';
  data: string; // base64
  mimeType: string;
}

export interface ResourcePromptContent {
  type: 'resource';
  resource: ResourceContents;
}

/**
 * Zod validators for prompt content
 */
export const TextPromptContentZod = z.object({
  type: z.literal('text'),
  text: z.string(),
});

export const ImagePromptContentZod = z.object({
  type: z.literal('image'),
  data: z.string(),
  mimeType: z.string(),
});

export const AudioPromptContentZod = z.object({
  type: z.literal('audio'),
  data: z.string(),
  mimeType: z.string(),
});

export const ResourcePromptContentZod = z.object({
  type: z.literal('resource'),
  resource: ResourceContentsZod,
});

export const PromptMessageContentZod = z.discriminatedUnion('type', [
  TextPromptContentZod,
  ImagePromptContentZod,
  AudioPromptContentZod,
  ResourcePromptContentZod,
]);

/**
 * Get Prompt Result
 */
export interface GetPromptResult {
  /** Prompt description */
  description?: string;
  /** Prompt messages */
  messages: PromptMessage[];
}

/**
 * Zod validator for GetPromptResult
 */
export const GetPromptResultZod = z.object({
  description: z.string().optional(),
  messages: z.array(PromptMessageZod),
});

// ============================================================================
// Logging
// ============================================================================

/**
 * Logging Capability
 */
export interface LoggingCapability {
  /** Supported log levels */
  levels?: LogLevel[];
}

/**
 * Zod validator for LoggingCapability
 */
export const LoggingCapabilityZod = z.object({
  levels: z.array(z.string()).optional(),
});

/**
 * Log Levels
 */
export type LogLevel =
  | 'debug'
  | 'info'
  | 'notice'
  | 'warning'
  | 'error'
  | 'critical'
  | 'alert'
  | 'emergency';

/**
 * Set Log Level Parameters
 */
export interface SetLogLevelParams {
  /** Log level */
  level: LogLevel;
}

/**
 * Zod validator for SetLogLevelParams
 */
export const SetLogLevelParamsZod = z.object({
  level: z.enum(['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency']),
});

/**
 * Log Message Notification
 */
export interface LogMessageNotification {
  /** Log level */
  level: LogLevel;
  /** Logger name */
  logger?: string;
  /** Log message */
  message: string;
  /** Additional data */
  data?: unknown;
}

/**
 * Zod validator for LogMessageNotification
 */
export const LogMessageNotificationZod = z.object({
  level: z.enum(['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency']),
  logger: z.string().optional(),
  message: z.string(),
  data: z.unknown().optional(),
});

// ============================================================================
// Pagination
// ============================================================================

/**
 * Pagination Parameters
 */
export interface PaginationParams {
  /** Cursor for next page */
  cursor?: string;
  /** Maximum items per page */
  limit?: number;
}

/**
 * Zod validator for PaginationParams
 */
export const PaginationParamsZod = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().positive().optional(),
});

/**
 * Paginated Result
 */
export interface PaginatedResult<T> {
  /** Items */
  items: T[];
  /** Next cursor */
  nextCursor?: string;
  /** Total count (if available) */
  total?: number;
}

/**
 * Zod validator for PaginatedResult
 */
export function PaginatedResultZod<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    nextCursor: z.string().optional(),
    total: z.number().int().nonnegative().optional(),
  });
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize Request Parameters
 */
export interface InitializeParams {
  /** Protocol version client supports */
  protocolVersion: string;
  /** Client capabilities */
  capabilities: ClientCapabilities;
  /** Client info */
  clientInfo: ImplementationInfo;
}

/**
 * Zod validator for InitializeParams
 */
export const InitializeParamsZod = z.object({
  protocolVersion: z.string().min(1),
  capabilities: ClientCapabilitiesZod,
  clientInfo: ImplementationInfoZod,
});

/**
 * Initialize Response Result
 */
export interface InitializeResult {
  /** Negotiated protocol version */
  protocolVersion: string;
  /** Server capabilities */
  capabilities: ServerCapabilities;
  /** Server info */
  serverInfo: ImplementationInfo;
  /** Instructions for the client */
  instructions?: string;
}

/**
 * Zod validator for InitializeResult
 */
export const InitializeResultZod = z.object({
  protocolVersion: z.string().min(1),
  capabilities: ServerCapabilitiesZod,
  serverInfo: ImplementationInfoZod,
  instructions: z.string().optional(),
});

/**
 * Implementation Information
 */
export interface ImplementationInfo {
  /** Implementation name */
  name: string;
  /** Implementation version */
  version: string;
  /** Implementation metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Zod validator for ImplementationInfo
 */
export const ImplementationInfoZod = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});

// ============================================================================
// Completion
// ============================================================================

/**
 * Completion Request Parameters
 */
export interface CompleteParams {
  /** Reference to complete */
  ref: CompletionReference;
  /** Argument to complete */
  argument: CompletionArgument;
}

/**
 * Zod validator for CompleteParams
 */
export const CompleteParamsZod = z.object({
  ref: CompletionReferenceZod,
  argument: CompletionArgumentZod,
});

/**
 * Completion Reference
 */
export type CompletionReference =
  | ToolCompletionReference
  | PromptCompletionReference
  | ResourceCompletionReference;

export interface ToolCompletionReference {
  type: 'ref/tool';
  name: string;
}

export interface PromptCompletionReference {
  type: 'ref/prompt';
  name: string;
}

export interface ResourceCompletionReference {
  type: 'ref/resource';
  uri: string;
}

export const ToolCompletionReferenceZod = z.object({
  type: z.literal('ref/tool'),
  name: z.string().min(1),
});

export const PromptCompletionReferenceZod = z.object({
  type: z.literal('ref/prompt'),
  name: z.string().min(1),
});

export const ResourceCompletionReferenceZod = z.object({
  type: z.literal('ref/resource'),
  uri: z.string().min(1),
});

export const CompletionReferenceZod = z.discriminatedUnion('type', [
  ToolCompletionReferenceZod,
  PromptCompletionReferenceZod,
  ResourceCompletionReferenceZod,
]);

/**
 * Completion Argument
 */
export interface CompletionArgument {
  /** Argument name */
  name: string;
  /** Current value */
  value: string;
}

/**
 * Zod validator for CompletionArgument
 */
export const CompletionArgumentZod = z.object({
  name: z.string().min(1),
  value: z.string(),
});

/**
 * Completion Result
 */
export interface CompleteResult {
  /** Completion suggestions */
  completion: CompletionSuggestion;
}

export interface CompletionSuggestion {
  /** Suggested values */
  values: string[];
  /** Total available (if known) */
  total?: number;
  /** Whether there are more values */
  hasMore?: boolean;
}

/**
 * Zod validator for CompleteResult
 */
export const CompleteResultZod = z.object({
  completion: z.object({
    values: z.array(z.string()),
    total: z.number().int().nonnegative().optional(),
    hasMore: z.boolean().optional(),
  }),
});

// ============================================================================
// Roots (Client-side)
// ============================================================================

/**
 * Root Definition - a filesystem root the client exposes
 */
export interface Root {
  /** Root URI */
  uri: string;
  /** Human-readable name */
  name?: string;
}

/**
 * Zod validator for Root
 */
export const RootZod = z.object({
  uri: z.string().min(1),
  name: z.string().optional(),
});

/**
 * List Roots Result
 */
export interface ListRootsResult {
  /** Roots */
  roots: Root[];
}

/**
 * Zod validator for ListRootsResult
 */
export const ListRootsResultZod = z.object({
  roots: z.array(RootZod),
});

/**
 * Roots List Changed Notification
 */
export interface RootsListChangedNotification {}

// ============================================================================
// Sampling (Server requests client to sample)
// ============================================================================

/**
 * Sampling Request Parameters
 */
export interface CreateMessageParams {
  /** Messages to sample from */
  messages: SamplingMessage[];
  /** Model preferences */
  modelPreferences?: ModelPreferences;
  /** System prompt */
  systemPrompt?: string;
  /** Include context */
  includeContext?: 'none' | 'thisServer' | 'allServers';
  /** Temperature */
  temperature?: number;
  /** Max tokens */
  maxTokens: number;
  /** Stop sequences */
  stopSequences?: string[];
  /** Metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Zod validator for CreateMessageParams
 */
export const CreateMessageParamsZod = z.object({
  messages: z.array(z.unknown()),
  modelPreferences: z.unknown().optional(),
  systemPrompt: z.string().optional(),
  includeContext: z.enum(['none', 'thisServer', 'allServers']).optional(),
  temperature: z.number().optional(),
  maxTokens: z.number().int().positive(),
  stopSequences: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Model Preferences
 */
export interface ModelPreferences {
  /** Hints for model selection */
  hints?: ModelHint[];
  /** Cost priority (0-1) */
  costPriority?: number;
  /** Speed priority (0-1) */
  speedPriority?: number;
  /** Intelligence priority (0-1) */
  intelligencePriority?: number;
}

export interface ModelHint {
  /** Model name hint */
  name?: string;
}

/**
 * Sampling Message
 */
export interface SamplingMessage {
  /** Role */
  role: 'user' | 'assistant';
  /** Content */
  content: PromptMessageContent;
}

/**
 * Create Message Result
 */
export interface CreateMessageResult {
  /** Sampled message */
  message: SamplingMessage;
  /** Model used */
  model: string;
  /** Stop reason */
  stopReason?: 'endTurn' | 'stopSequence' | 'maxTokens' | 'error';
}

/**
 * Zod validator for CreateMessageResult
 */
export const CreateMessageResultZod = z.object({
  message: z.unknown(),
  model: z.string(),
  stopReason: z.enum(['endTurn', 'stopSequence', 'maxTokens', 'error']).optional(),
});

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Method Names - all MCP method names as a union type
 */
export type MCPMethodName =
  // Lifecycle
  | 'initialize'
  | 'initialized'
  | 'shutdown'
  // Tools
  | 'tools/list'
  | 'tools/call'
  // Resources
  | 'resources/list'
  | 'resources/templates/list'
  | 'resources/read'
  | 'resources/subscribe'
  | 'resources/unsubscribe'
  // Prompts
  | 'prompts/list'
  | 'prompts/get'
  // Completion
  | 'completion/complete'
  // Logging
  | 'logging/setLevel'
  // Roots
  | 'roots/list'
  // Sampling
  | 'sampling/createMessage'
  // Notifications
  | 'notifications/tools/list_changed'
  | 'notifications/resources/list_changed'
  | 'notifications/resources/updated'
  | 'notifications/prompts/list_changed'
  | 'notifications/roots/list_changed'
  | 'notifications/message'
  | 'notifications/log';

/**
 * Request Parameter Types by Method
 */
export interface MCPRequestParams {
  initialize: InitializeParams;
  'tools/list': PaginationParams;
  'tools/call': CallToolParams;
  'resources/list': PaginationParams;
  'resources/templates/list': PaginationParams;
  'resources/read': ReadResourceParams;
  'resources/subscribe': SubscribeResourceParams;
  'resources/unsubscribe': UnsubscribeResourceParams;
  'prompts/list': PaginationParams;
  'prompts/get': GetPromptParams;
  'completion/complete': CompleteParams;
  'logging/setLevel': SetLogLevelParams;
  'roots/list': Record<string, never>;
  'sampling/createMessage': CreateMessageParams;
}

/**
 * Response Result Types by Method
 */
export interface MCPResponseResults {
  initialize: InitializeResult;
  'tools/list': { tools: Tool[]; nextCursor?: string };
  'tools/call': CallToolResult;
  'resources/list': { resources: Resource[]; nextCursor?: string };
  'resources/templates/list': { resourceTemplates: ResourceTemplate[]; nextCursor?: string };
  'resources/read': { contents: ResourceContents[] };
  'resources/subscribe': Record<string, never>;
  'resources/unsubscribe': Record<string, never>;
  'prompts/list': { prompts: Prompt[]; nextCursor?: string };
  'prompts/get': GetPromptResult;
  'completion/complete': CompleteResult;
  'logging/setLevel': Record<string, never>;
  'roots/list': ListRootsResult;
  'sampling/createMessage': CreateMessageResult;
}

/**
 * Notification Parameter Types
 */
export interface MCPNotificationParams {
  'notifications/tools/list_changed': Record<string, never>;
  'notifications/resources/list_changed': Record<string, never>;
  'notifications/resources/updated': ResourceUpdatedNotification;
  'notifications/prompts/list_changed': Record<string, never>;
  'notifications/roots/list_changed': RootsListChangedNotification;
  'notifications/message': LogMessageNotification;
  'notifications/log': LogMessageNotification;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if message is a request
 */
export function isRequest(message: MCPMessage): message is MCPMessage & { method: string; id: string | number } {
  return message.method !== undefined && message.id !== undefined;
}

/**
 * Check if message is a notification
 */
export function isNotification(message: MCPMessage): message is MCPMessage & { method: string; id?: undefined } {
  return message.method !== undefined && message.id === undefined;
}

/**
 * Check if message is a response
 */
export function isResponse(message: MCPMessage): message is MCPMessage & { id: string | number; result?: unknown; error?: MCPError } {
  return message.id !== undefined && (message.result !== undefined || message.error !== undefined);
}

/**
 * Check if message is an error response
 */
export function isErrorResponse(message: MCPMessage): message is MCPMessage & { id: string | number; error: MCPError } {
  return message.error !== undefined;
}

/**
 * Check if value is a valid MCPError
 */
export function isMCPError(value: unknown): value is MCPError {
  return MCPErrorZod.safeParse(value).success;
}

/**
 * Check if value is a valid Tool
 */
export function isTool(value: unknown): value is Tool {
  return ToolZod.safeParse(value).success;
}

/**
 * Check if value is a valid Resource
 */
export function isResource(value: unknown): value is Resource {
  return ResourceZod.safeParse(value).success;
}

/**
 * Check if value is a valid Prompt
 */
export function isPrompt(value: unknown): value is Prompt {
  return PromptZod.safeParse(value).success;
}

/**
 * Check if value is a valid ResourceContents
 */
export function isResourceContents(value: unknown): value is ResourceContents {
  return ResourceContentsZod.safeParse(value).success;
}

// ============================================================================
// Re-exports
// ============================================================================

export {
  // Zod schemas
  MCPMessageZod,
  MCPErrorZod,
  ClientCapabilitiesZod,
  ServerCapabilitiesZod,
  ToolZod,
  ToolAnnotationsZod,
  ToolsCapabilityZod,
  CallToolParamsZod,
  CallToolResultZod,
  ToolResultContentZod,
  TextContentZod,
  ImageContentZod,
  AudioContentZod,
  ResourceLinkContentZod,
  EmbeddedResourceContentZod,
  ResourceZod,
  ResourceAnnotationsZod,
  ResourcesCapabilityZod,
  ResourceContentsZod,
  ReadResourceParamsZod,
  ResourceTemplateZod,
  SubscribeResourceParamsZod,
  UnsubscribeResourceParamsZod,
  ResourceUpdatedNotificationZod,
  PromptZod,
  PromptArgumentZod,
  PromptsCapabilityZod,
  GetPromptParamsZod,
  GetPromptResultZod,
  PromptMessageZod,
  PromptMessageContentZod,
  TextPromptContentZod,
  ImagePromptContentZod,
  AudioPromptContentZod,
  ResourcePromptContentZod,
  LoggingCapabilityZod,
  SetLogLevelParamsZod,
  LogMessageNotificationZod,
  PaginationParamsZod,
  InitializeParamsZod,
  InitializeResultZod,
  ImplementationInfoZod,
  CompleteParamsZod,
  CompleteResultZod,
  CompletionReferenceZod,
  CompletionArgumentZod,
  RootZod,
  ListRootsResultZod,
  CreateMessageParamsZod,
  CreateMessageResultZod,
  JSONSchemaZod,
  JSON_RPC_ERROR_CODES,
  MCP_ERROR_CODES,
};
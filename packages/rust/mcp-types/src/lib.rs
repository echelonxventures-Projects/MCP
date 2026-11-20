//! mcp-types - Rust MCP Protocol Types
//! Auto-generated from spec/protocol/mcp-core.ts
//! DO NOT EDIT MANUALLY

use serde::{Deserialize, Serialize};
use schemars::JsonSchema;
use validator::Validate;
use thiserror::Error;
use std::collections::HashMap;

// ============================================================================
// Branded Types
// ============================================================================

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
pub struct ServerId(pub String);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
pub struct ToolName(pub String);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
pub struct ResourceUri(pub String);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
pub struct PromptName(pub String);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
pub struct ConnectionId(pub String);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
pub struct RequestId(pub String);

impl ServerId {
    pub fn new(value: String) -> Self { Self(value) }
}

impl ToolName {
    pub fn new(value: String) -> Self { Self(value) }
}

impl ResourceUri {
    pub fn new(value: String) -> Self { Self(value) }
}

impl PromptName {
    pub fn new(value: String) -> Self { Self(value) }
}

impl ConnectionId {
    pub fn new(value: String) -> Self { Self(value) }
}

impl RequestId {
    pub fn new(value: String) -> Self { Self(value) }
}

// ============================================================================
// JSON Schema
// ============================================================================

pub type JSONSchema = serde_json::Value;

// ============================================================================
// Errors
// ============================================================================

#[derive(Debug, Error)]
pub enum MCPError {
    #[error("validation error: {0}")]
    Validation(String),
    #[error("invalid tool result: missing content")]
    InvalidToolResult,
    #[error("invalid resource contents: missing uri or mimeType")]
    InvalidResourceContents,
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

// ============================================================================
// Protocol Types
// ============================================================================
/// 
JSON Schema Draft 2020-12 compatible type
Used for tool input/output schemas and resource schemas
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct JSONSchema {
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "title", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "description", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "default", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "examples", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "multipleOf", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "maximum", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "exclusiveMaximum", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "minimum", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "exclusiveMinimum", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "maxLength", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "minLength", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "pattern", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "format", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "maxItems", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "minItems", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "uniqueItems", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "items", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "maxProperties", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "minProperties", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "required", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "properties", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "patternProperties", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "additionalProperties", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "allOf", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "anyOf", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "oneOf", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "not", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "$ref", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "$defs", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "$schema", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "const", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "enum", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "discriminator", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "externalDocs", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "nullable", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "readOnly", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "writeOnly", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "deprecated", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
}

impl JSONSchema {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct Discriminator {
    #[serde(rename = "propertyName")]
    String,
    #[serde(rename = "mapping", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
}

impl Discriminator {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct ExternalDocumentation {
    #[serde(rename = "description", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "url")]
    String,
}

impl ExternalDocumentation {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
JSON-RPC 2.0 Message Envelope
All MCP communication uses JSON-RPC 2.0 framing
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct MCPMessage {
    #[serde(rename = "jsonrpc")]
    "2.0",
    #[serde(rename = "id", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "method", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "params", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "result", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "error", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
}

impl MCPMessage {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
MCP Error Structure (JSON-RPC 2.0 compatible)
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct MCPError {
    #[serde(rename = "code")]
    f64,
    #[serde(rename = "message")]
    String,
    #[serde(rename = "data", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
}

impl MCPError {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Client Capabilities - what the client supports
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct ClientCapabilities {
    #[serde(rename = "tools", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "resources", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "prompts", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "experimental", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
}

impl ClientCapabilities {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Server Capabilities - what the server provides
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct ServerCapabilities {
    #[serde(rename = "tools", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "resources", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "prompts", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "logging", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "experimental", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
}

impl ServerCapabilities {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Tool Annotations - metadata about tool behavior
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct ToolAnnotations {
    #[serde(rename = "readOnly", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "idempotent", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "destructive", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "estimatedDurationMs", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "requiredPermissions", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
}

impl ToolAnnotations {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Tool Definition - a callable function exposed by the server
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct Tool {
    #[serde(rename = "name")]
    String,
    #[serde(rename = "description")]
    String,
    #[serde(rename = "inputSchema")]
    import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").JSONSchema,
    #[serde(rename = "outputSchema", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "annotations", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
}

impl Tool {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Tools Capability
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct ToolsCapability {
    #[serde(rename = "listChanged", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
}

impl ToolsCapability {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Tool Call Request Parameters
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct CallToolParams {
    #[serde(rename = "name")]
    String,
    #[serde(rename = "arguments")]
    HashMap<String, serde_json::Value>,
}

impl CallToolParams {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Tool Call Result
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct CallToolResult {
    #[serde(rename = "content")]
    Vec<import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ToolResultContent>,
    #[serde(rename = "isError", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "structuredContent", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
}

impl CallToolResult {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct TextContent {
    #[serde(rename = "type")]
    "text",
    #[serde(rename = "text")]
    String,
    #[serde(rename = "annotations", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
}

impl TextContent {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct ImageContent {
    #[serde(rename = "type")]
    "image",
    #[serde(rename = "data")]
    String,
    #[serde(rename = "mimeType")]
    String,
    #[serde(rename = "annotations", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
}

impl ImageContent {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct AudioContent {
    #[serde(rename = "type")]
    "audio",
    #[serde(rename = "data")]
    String,
    #[serde(rename = "mimeType")]
    String,
    #[serde(rename = "annotations", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
}

impl AudioContent {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct ResourceLinkContent {
    #[serde(rename = "type")]
    "resource_link",
    #[serde(rename = "uri")]
    String,
    #[serde(rename = "name", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "description", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "mimeType", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "annotations", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
}

impl ResourceLinkContent {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct EmbeddedResourceContent {
    #[serde(rename = "type")]
    "resource",
    #[serde(rename = "resource")]
    import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ResourceContents,
    #[serde(rename = "annotations", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
}

impl EmbeddedResourceContent {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Resource Annotations - metadata about resource
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct ResourceAnnotations {
    #[serde(rename = "readOnly", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "size", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "lastModified", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
}

impl ResourceAnnotations {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Resource Definition - a readable data source
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct Resource {
    #[serde(rename = "uri")]
    String,
    #[serde(rename = "name")]
    String,
    #[serde(rename = "description", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "mimeType", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "annotations", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
}

impl Resource {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Resources Capability
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct ResourcesCapability {
    #[serde(rename = "subscribe", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "listChanged", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
}

impl ResourcesCapability {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Resource Contents - actual resource data
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct ResourceContents {
    #[serde(rename = "uri")]
    String,
    #[serde(rename = "mimeType")]
    String,
    #[serde(rename = "text", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "blob", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
}

impl ResourceContents {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Read Resource Parameters
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct ReadResourceParams {
    #[serde(rename = "uri")]
    String,
}

impl ReadResourceParams {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Resource Template - for dynamic resource discovery
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct ResourceTemplate {
    #[serde(rename = "uriTemplate")]
    String,
    #[serde(rename = "name")]
    String,
    #[serde(rename = "description", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "mimeType", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "annotations", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
}

impl ResourceTemplate {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Subscribe Resource Parameters
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct SubscribeResourceParams {
    #[serde(rename = "uri")]
    String,
}

impl SubscribeResourceParams {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Unsubscribe Resource Parameters
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct UnsubscribeResourceParams {
    #[serde(rename = "uri")]
    String,
}

impl UnsubscribeResourceParams {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Resource Updated Notification
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct ResourceUpdatedNotification {
    #[serde(rename = "uri")]
    String,
}

impl ResourceUpdatedNotification {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Prompt Argument Definition
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct PromptArgument {
    #[serde(rename = "name")]
    String,
    #[serde(rename = "description", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "required", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
}

impl PromptArgument {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Prompt Definition - a reusable prompt template
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct Prompt {
    #[serde(rename = "name")]
    String,
    #[serde(rename = "description", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "arguments", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
}

impl Prompt {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Prompts Capability
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct PromptsCapability {
    #[serde(rename = "listChanged", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
}

impl PromptsCapability {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Get Prompt Parameters
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct GetPromptParams {
    #[serde(rename = "name")]
    String,
    #[serde(rename = "arguments", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
}

impl GetPromptParams {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Prompt Message - a message in a prompt conversation
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct PromptMessage {
    #[serde(rename = "role")]
    serde_json::Value,
    #[serde(rename = "content")]
    import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").PromptMessageContent,
}

impl PromptMessage {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct TextPromptContent {
    #[serde(rename = "type")]
    "text",
    #[serde(rename = "text")]
    String,
}

impl TextPromptContent {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct ImagePromptContent {
    #[serde(rename = "type")]
    "image",
    #[serde(rename = "data")]
    String,
    #[serde(rename = "mimeType")]
    String,
}

impl ImagePromptContent {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct AudioPromptContent {
    #[serde(rename = "type")]
    "audio",
    #[serde(rename = "data")]
    String,
    #[serde(rename = "mimeType")]
    String,
}

impl AudioPromptContent {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct ResourcePromptContent {
    #[serde(rename = "type")]
    "resource",
    #[serde(rename = "resource")]
    import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ResourceContents,
}

impl ResourcePromptContent {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Get Prompt Result
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct GetPromptResult {
    #[serde(rename = "description", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "messages")]
    Vec<import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").PromptMessage>,
}

impl GetPromptResult {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Logging Capability
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct LoggingCapability {
    #[serde(rename = "levels", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
}

impl LoggingCapability {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Set Log Level Parameters
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct SetLogLevelParams {
    #[serde(rename = "level")]
    import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").LogLevel,
}

impl SetLogLevelParams {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Log Message Notification
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct LogMessageNotification {
    #[serde(rename = "level")]
    import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").LogLevel,
    #[serde(rename = "logger", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "message")]
    String,
    #[serde(rename = "data", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
}

impl LogMessageNotification {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Pagination Parameters
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct PaginationParams {
    #[serde(rename = "cursor", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "limit", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
}

impl PaginationParams {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Paginated Result
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct PaginatedResult {
    #[serde(rename = "items")]
    Vec<T>,
    #[serde(rename = "nextCursor", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "total", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
}

impl PaginatedResult {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Initialize Request Parameters
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct InitializeParams {
    #[serde(rename = "protocolVersion")]
    String,
    #[serde(rename = "capabilities")]
    import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ClientCapabilities,
    #[serde(rename = "clientInfo")]
    import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ImplementationInfo,
}

impl InitializeParams {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Initialize Response Result
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct InitializeResult {
    #[serde(rename = "protocolVersion")]
    String,
    #[serde(rename = "capabilities")]
    import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ServerCapabilities,
    #[serde(rename = "serverInfo")]
    import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ImplementationInfo,
    #[serde(rename = "instructions", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
}

impl InitializeResult {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Implementation Information
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct ImplementationInfo {
    #[serde(rename = "name")]
    String,
    #[serde(rename = "version")]
    String,
    #[serde(rename = "metadata", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
}

impl ImplementationInfo {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Completion Request Parameters
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct CompleteParams {
    #[serde(rename = "ref")]
    import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").CompletionReference,
    #[serde(rename = "argument")]
    import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").CompletionArgument,
}

impl CompleteParams {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct ToolCompletionReference {
    #[serde(rename = "type")]
    "ref/tool",
    #[serde(rename = "name")]
    String,
}

impl ToolCompletionReference {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct PromptCompletionReference {
    #[serde(rename = "type")]
    "ref/prompt",
    #[serde(rename = "name")]
    String,
}

impl PromptCompletionReference {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct ResourceCompletionReference {
    #[serde(rename = "type")]
    "ref/resource",
    #[serde(rename = "uri")]
    String,
}

impl ResourceCompletionReference {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Completion Argument
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct CompletionArgument {
    #[serde(rename = "name")]
    String,
    #[serde(rename = "value")]
    String,
}

impl CompletionArgument {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Completion Result
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct CompleteResult {
    #[serde(rename = "completion")]
    import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").CompletionSuggestion,
}

impl CompleteResult {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct CompletionSuggestion {
    #[serde(rename = "values")]
    Vec<String>,
    #[serde(rename = "total", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "hasMore", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
}

impl CompletionSuggestion {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Root Definition - a filesystem root the client exposes
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct Root {
    #[serde(rename = "uri")]
    String,
    #[serde(rename = "name", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
}

impl Root {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
List Roots Result
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct ListRootsResult {
    #[serde(rename = "roots")]
    Vec<import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").Root>,
}

impl ListRootsResult {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Roots List Changed Notification
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct RootsListChangedNotification {
}

impl RootsListChangedNotification {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Sampling Request Parameters
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct CreateMessageParams {
    #[serde(rename = "messages")]
    Vec<import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").SamplingMessage>,
    #[serde(rename = "modelPreferences", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "systemPrompt", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "includeContext", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "temperature", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "maxTokens")]
    f64,
    #[serde(rename = "stopSequences", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "metadata", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
}

impl CreateMessageParams {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Model Preferences
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct ModelPreferences {
    #[serde(rename = "hints", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "costPriority", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "speedPriority", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
    #[serde(rename = "intelligencePriority", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
}

impl ModelPreferences {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct ModelHint {
    #[serde(rename = "name", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
}

impl ModelHint {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Sampling Message
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct SamplingMessage {
    #[serde(rename = "role")]
    serde_json::Value,
    #[serde(rename = "content")]
    import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").PromptMessageContent,
}

impl SamplingMessage {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Create Message Result
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct CreateMessageResult {
    #[serde(rename = "message")]
    import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").SamplingMessage,
    #[serde(rename = "model")]
    String,
    #[serde(rename = "stopReason", skip_serializing_if = "Option::is_none")]
    Option<serde_json::Value>,
}

impl CreateMessageResult {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Request Parameter Types by Method
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct MCPRequestParams {
    #[serde(rename = "initialize")]
    import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").InitializeParams,
    #[serde(rename = "'tools/list'")]
    import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").PaginationParams,
    #[serde(rename = "'tools/call'")]
    import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").CallToolParams,
    #[serde(rename = "'resources/list'")]
    import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").PaginationParams,
    #[serde(rename = "'resources/templates/list'")]
    import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").PaginationParams,
    #[serde(rename = "'resources/read'")]
    import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ReadResourceParams,
    #[serde(rename = "'resources/subscribe'")]
    import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").SubscribeResourceParams,
    #[serde(rename = "'resources/unsubscribe'")]
    import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").UnsubscribeResourceParams,
    #[serde(rename = "'prompts/list'")]
    import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").PaginationParams,
    #[serde(rename = "'prompts/get'")]
    import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").GetPromptParams,
    #[serde(rename = "'completion/complete'")]
    import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").CompleteParams,
    #[serde(rename = "'logging/setLevel'")]
    import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").SetLogLevelParams,
    #[serde(rename = "'roots/list'")]
    Record<string, never>,
    #[serde(rename = "'sampling/createMessage'")]
    import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").CreateMessageParams,
}

impl MCPRequestParams {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Response Result Types by Method
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct MCPResponseResults {
    #[serde(rename = "initialize")]
    import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").InitializeResult,
    #[serde(rename = "'tools/list'")]
    serde_json::Value,
    #[serde(rename = "'tools/call'")]
    import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").CallToolResult,
    #[serde(rename = "'resources/list'")]
    serde_json::Value,
    #[serde(rename = "'resources/templates/list'")]
    serde_json::Value,
    #[serde(rename = "'resources/read'")]
    { contents: import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ResourceContents[]; },
    #[serde(rename = "'resources/subscribe'")]
    Record<string, never>,
    #[serde(rename = "'resources/unsubscribe'")]
    Record<string, never>,
    #[serde(rename = "'prompts/list'")]
    serde_json::Value,
    #[serde(rename = "'prompts/get'")]
    import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").GetPromptResult,
    #[serde(rename = "'completion/complete'")]
    import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").CompleteResult,
    #[serde(rename = "'logging/setLevel'")]
    Record<string, never>,
    #[serde(rename = "'roots/list'")]
    import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ListRootsResult,
    #[serde(rename = "'sampling/createMessage'")]
    import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").CreateMessageResult,
}

impl MCPResponseResults {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

/// 
Notification Parameter Types
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Validate)]
pub struct MCPNotificationParams {
    #[serde(rename = "'notifications/tools/list_changed'")]
    Record<string, never>,
    #[serde(rename = "'notifications/resources/list_changed'")]
    Record<string, never>,
    #[serde(rename = "'notifications/resources/updated'")]
    import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ResourceUpdatedNotification,
    #[serde(rename = "'notifications/prompts/list_changed'")]
    Record<string, never>,
    #[serde(rename = "'notifications/roots/list_changed'")]
    import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").RootsListChangedNotification,
    #[serde(rename = "'notifications/message'")]
    import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").LogMessageNotification,
    #[serde(rename = "'notifications/log'")]
    import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").LogMessageNotification,
}

impl MCPNotificationParams {
    pub fn validate(&self) -> Result<(), MCPError> {
        self.validate().map_err(|e| MCPError::Validation(e.to_string()))
    }
}

// ============================================================================
// Utility Functions
// ============================================================================

pub fn validate_tool_result(data: &serde_json::Value) -> Result<(), MCPError> {
    if data.get("content").is_none() {
        return Err(MCPError::InvalidToolResult);
    }
    Ok(())
}

pub fn validate_resource_contents(data: &serde_json::Value) -> Result<(), MCPError> {
    if data.get("uri").is_none() || data.get("mimeType").is_none() {
        return Err(MCPError::InvalidResourceContents);
    }
    Ok(())
}

pub fn generate_json_schema<T: JsonSchema>() -> Result<JSONSchema, MCPError> {
    let schema = schemars::schema_for!(T);
    Ok(serde_json::to_value(schema)?)
}

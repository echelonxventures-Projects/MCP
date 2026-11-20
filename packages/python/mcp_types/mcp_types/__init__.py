"""
mcp-types - Python MCP Protocol Types
Auto-generated from spec/protocol/mcp-core.ts
DO NOT EDIT MANUALLY
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Union, Literal, Annotated
from pydantic import BaseModel, Field, ConfigDict, TypeAdapter
from typing_extensions import NewType
import json


# ============================================================================
# Branded Types
# ============================================================================

ServerId = NewType('ServerId', str)
ToolName = NewType('ToolName', str)
ResourceUri = NewType('ResourceUri', str)
PromptName = NewType('PromptName', str)
ConnectionId = NewType('ConnectionId', str)
RequestId = NewType('RequestId', str)


def create_server_id(value: str) -> ServerId:
    return ServerId(value)


def create_tool_name(value: str) -> ToolName:
    return ToolName(value)


def create_resource_uri(value: str) -> ResourceUri:
    return ResourceUri(value)


def create_prompt_name(value: str) -> PromptName:
    return PromptName(value)


def create_connection_id(value: str) -> ConnectionId:
    return ConnectionId(value)


def create_request_id(value: str) -> RequestId:
    return RequestId(value)


# ============================================================================
# JSON Schema
# ============================================================================

JSONSchema = Dict[str, Any]


# ============================================================================
# Protocol Types
# ============================================================================
class JSONSchema(BaseModel):
    """
JSON Schema Draft 2020-12 compatible type
Used for tool input/output schemas and resource schemas"""
    model_config = ConfigDict(extra='allow')

    type: Optional[Union[import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").JSONSchemaType, List[import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").JSONSchemaType], undefined]] = Field(default=None)
    title: Optional[Union[str, undefined]] = Field(default=None)
    description: Optional[Union[str, undefined]] = Field(default=None)
    default: Optional[Any] = Field(default=None)
    examples: Optional[Union[List[Any], undefined]] = Field(default=None)
    multipleOf: Optional[Union[float, undefined]] = Field(default=None)
    maximum: Optional[Union[float, undefined]] = Field(default=None)
    exclusiveMaximum: Optional[Union[float, bool, undefined]] = Field(default=None)
    minimum: Optional[Union[float, undefined]] = Field(default=None)
    exclusiveMinimum: Optional[Union[float, bool, undefined]] = Field(default=None)
    maxLength: Optional[Union[float, undefined]] = Field(default=None)
    minLength: Optional[Union[float, undefined]] = Field(default=None)
    pattern: Optional[Union[str, undefined]] = Field(default=None)
    format: Optional[Union[str, undefined]] = Field(default=None)
    maxItems: Optional[Union[float, undefined]] = Field(default=None)
    minItems: Optional[Union[float, undefined]] = Field(default=None)
    uniqueItems: Optional[Union[bool, undefined]] = Field(default=None)
    items: Optional[Union[import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").JSONSchema, List[import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").JSONSchema], undefined]] = Field(default=None)
    maxProperties: Optional[Union[float, undefined]] = Field(default=None)
    minProperties: Optional[Union[float, undefined]] = Field(default=None)
    required: Optional[Union[List[str], undefined]] = Field(default=None)
    properties: Optional[Union[Record<string, import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").JSONSchema>, undefined]] = Field(default=None)
    patternProperties: Optional[Union[Record<string, import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").JSONSchema>, undefined]] = Field(default=None)
    additionalProperties: Optional[Union[bool, import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").JSONSchema, undefined]] = Field(default=None)
    allOf: Optional[Union[List[import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").JSONSchema], undefined]] = Field(default=None)
    anyOf: Optional[Union[List[import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").JSONSchema], undefined]] = Field(default=None)
    oneOf: Optional[Union[List[import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").JSONSchema], undefined]] = Field(default=None)
    not: Optional[Union[import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").JSONSchema, undefined]] = Field(default=None)
    $ref: Optional[Union[str, undefined]] = Field(default=None)
    $defs: Optional[Union[Record<string, import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").JSONSchema>, undefined]] = Field(default=None)
    $schema: Optional[Union[str, undefined]] = Field(default=None)
    const: Optional[Any] = Field(default=None)
    enum: Optional[Union[List[Any], undefined]] = Field(default=None)
    discriminator: Optional[Union[import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").Discriminator, undefined]] = Field(default=None)
    externalDocs: Optional[Union[import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ExternalDocumentation, undefined]] = Field(default=None)
    nullable: Optional[Union[bool, undefined]] = Field(default=None)
    readOnly: Optional[Union[bool, undefined]] = Field(default=None)
    writeOnly: Optional[Union[bool, undefined]] = Field(default=None)
    deprecated: Optional[Union[bool, undefined]] = Field(default=None)


class Discriminator(BaseModel):
    """"""
    model_config = ConfigDict(extra='allow')

    propertyName: str
    mapping: Optional[Union[Dict[str, str], undefined]] = Field(default=None)


class ExternalDocumentation(BaseModel):
    """"""
    model_config = ConfigDict(extra='allow')

    description: Optional[Union[str, undefined]] = Field(default=None)
    url: str


class MCPMessage(BaseModel):
    """
JSON-RPC 2.0 Message Envelope
All MCP communication uses JSON-RPC 2.0 framing"""
    model_config = ConfigDict(extra='allow')

    jsonrpc: "2.0" = Field(description="JSON-RPC version - always \"2.0\"")
    id: Optional[Union[str, float, undefined]] = Field(description="Request ID - omitted for notifications")
    method: Optional[Union[str, undefined]] = Field(description="Method name for requests/notifications")
    params: Optional[Any] = Field(description="Method parameters")
    result: Optional[Any] = Field(description="Successful response result")
    error: Optional[Union[import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").MCPError, undefined]] = Field(description="Error response")


class MCPError(BaseModel):
    """
MCP Error Structure (JSON-RPC 2.0 compatible)"""
    model_config = ConfigDict(extra='allow')

    code: float = Field(description="Error code (JSON-RPC standard codes + MCP extensions)")
    message: str = Field(description="Human-readable error message")
    data: Optional[Any] = Field(description="Additional error data")


class ClientCapabilities(BaseModel):
    """
Client Capabilities - what the client supports"""
    model_config = ConfigDict(extra='allow')

    tools: Optional[Union[import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ToolsCapability, undefined]] = Field(description="Tool calling capability")
    resources: Optional[Union[import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ResourcesCapability, undefined]] = Field(description="Resource access capability")
    prompts: Optional[Union[import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").PromptsCapability, undefined]] = Field(description="Prompt rendering capability")
    experimental: Optional[Union[Dict[str, Any], undefined]] = Field(description="Experimental capabilities")


class ServerCapabilities(BaseModel):
    """
Server Capabilities - what the server provides"""
    model_config = ConfigDict(extra='allow')

    tools: Optional[Union[import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ToolsCapability, undefined]] = Field(description="Tool calling capability")
    resources: Optional[Union[import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ResourcesCapability, undefined]] = Field(description="Resource access capability")
    prompts: Optional[Union[import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").PromptsCapability, undefined]] = Field(description="Prompt rendering capability")
    logging: Optional[Union[import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").LoggingCapability, undefined]] = Field(description="Logging capability")
    experimental: Optional[Union[Dict[str, Any], undefined]] = Field(description="Experimental capabilities")


class ToolAnnotations(BaseModel):
    """
Tool Annotations - metadata about tool behavior"""
    model_config = ConfigDict(extra='allow')

    readOnly: Optional[Union[bool, undefined]] = Field(description="Tool is read-only (doesn't modify state)")
    idempotent: Optional[Union[bool, undefined]] = Field(description="Tool is idempotent (same input = same result)")
    destructive: Optional[Union[bool, undefined]] = Field(description="Tool may have side effects")
    estimatedDurationMs: Optional[Union[float, undefined]] = Field(description="Estimated execution time in milliseconds")
    requiredPermissions: Optional[Union[List[str], undefined]] = Field(description="Required permissions/scopes")


class Tool(BaseModel):
    """
Tool Definition - a callable function exposed by the server"""
    model_config = ConfigDict(extra='allow')

    name: str = Field(description="Unique tool name")
    description: str = Field(description="Human-readable description")
    inputSchema: import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").JSONSchema = Field(description="Input schema (JSON Schema)")
    outputSchema: Optional[Union[import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").JSONSchema, undefined]] = Field(description="Output schema (JSON Schema) - optional")
    annotations: Optional[Union[import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ToolAnnotations, undefined]] = Field(description="Tool behavior annotations")


class ToolsCapability(BaseModel):
    """
Tools Capability"""
    model_config = ConfigDict(extra='allow')

    listChanged: Optional[Union[bool, undefined]] = Field(description="Server supports list_changed notifications")


class CallToolParams(BaseModel):
    """
Tool Call Request Parameters"""
    model_config = ConfigDict(extra='allow')

    name: str = Field(description="Tool name")
    arguments: Dict[str, Any] = Field(description="Tool arguments")


class CallToolResult(BaseModel):
    """
Tool Call Result"""
    model_config = ConfigDict(extra='allow')

    content: List[import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ToolResultContent] = Field(description="Result content")
    isError: Optional[Union[bool, undefined]] = Field(description="Whether the result is an error")
    structuredContent: Optional[Any] = Field(description="Structured result data (optional)")


class TextContent(BaseModel):
    """"""
    model_config = ConfigDict(extra='allow')

    type: "text"
    text: str
    annotations: Optional[Union[Dict[str, Any], undefined]] = Field(description="Optional annotations")


class ImageContent(BaseModel):
    """"""
    model_config = ConfigDict(extra='allow')

    type: "image"
    data: str
    mimeType: str
    annotations: Optional[Union[Dict[str, Any], undefined]] = Field(description="Optional annotations")


class AudioContent(BaseModel):
    """"""
    model_config = ConfigDict(extra='allow')

    type: "audio"
    data: str
    mimeType: str
    annotations: Optional[Union[Dict[str, Any], undefined]] = Field(description="Optional annotations")


class ResourceLinkContent(BaseModel):
    """"""
    model_config = ConfigDict(extra='allow')

    type: "resource_link"
    uri: str
    name: Optional[Union[str, undefined]] = Field(default=None)
    description: Optional[Union[str, undefined]] = Field(default=None)
    mimeType: Optional[Union[str, undefined]] = Field(default=None)
    annotations: Optional[Union[Dict[str, Any], undefined]] = Field(description="Optional annotations")


class EmbeddedResourceContent(BaseModel):
    """"""
    model_config = ConfigDict(extra='allow')

    type: "resource"
    resource: import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ResourceContents
    annotations: Optional[Union[Dict[str, Any], undefined]] = Field(description="Optional annotations")


class ResourceAnnotations(BaseModel):
    """
Resource Annotations - metadata about resource"""
    model_config = ConfigDict(extra='allow')

    readOnly: Optional[Union[bool, undefined]] = Field(description="Resource is read-only")
    size: Optional[Union[float, undefined]] = Field(description="Resource size in bytes (if known)")
    lastModified: Optional[Union[float, undefined]] = Field(description="Last modified timestamp (Unix ms)")


class Resource(BaseModel):
    """
Resource Definition - a readable data source"""
    model_config = ConfigDict(extra='allow')

    uri: str = Field(description="Resource URI (unique identifier)")
    name: str = Field(description="Human-readable name")
    description: Optional[Union[str, undefined]] = Field(description="Description")
    mimeType: Optional[Union[str, undefined]] = Field(description="MIME type")
    annotations: Optional[Union[import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ResourceAnnotations, undefined]] = Field(description="Resource annotations")


class ResourcesCapability(BaseModel):
    """
Resources Capability"""
    model_config = ConfigDict(extra='allow')

    subscribe: Optional[Union[bool, undefined]] = Field(description="Server supports subscribe/unsubscribe")
    listChanged: Optional[Union[bool, undefined]] = Field(description="Server supports list_changed notifications")


class ResourceContents(BaseModel):
    """
Resource Contents - actual resource data"""
    model_config = ConfigDict(extra='allow')

    uri: str = Field(description="Resource URI")
    mimeType: str = Field(description="MIME type")
    text: Optional[Union[str, undefined]] = Field(description="Text content (for text resources)")
    blob: Optional[Union[str, undefined]] = Field(description="Binary content (base64 encoded)")


class ReadResourceParams(BaseModel):
    """
Read Resource Parameters"""
    model_config = ConfigDict(extra='allow')

    uri: str = Field(description="Resource URI")


class ResourceTemplate(BaseModel):
    """
Resource Template - for dynamic resource discovery"""
    model_config = ConfigDict(extra='allow')

    uriTemplate: str = Field(description="URI template (RFC 6570)")
    name: str = Field(description="Human-readable name")
    description: Optional[Union[str, undefined]] = Field(description="Description")
    mimeType: Optional[Union[str, undefined]] = Field(description="MIME type")
    annotations: Optional[Union[import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ResourceAnnotations, undefined]] = Field(description="Resource annotations")


class SubscribeResourceParams(BaseModel):
    """
Subscribe Resource Parameters"""
    model_config = ConfigDict(extra='allow')

    uri: str = Field(description="Resource URI")


class UnsubscribeResourceParams(BaseModel):
    """
Unsubscribe Resource Parameters"""
    model_config = ConfigDict(extra='allow')

    uri: str = Field(description="Resource URI")


class ResourceUpdatedNotification(BaseModel):
    """
Resource Updated Notification"""
    model_config = ConfigDict(extra='allow')

    uri: str = Field(description="Resource URI")


class PromptArgument(BaseModel):
    """
Prompt Argument Definition"""
    model_config = ConfigDict(extra='allow')

    name: str = Field(description="Argument name")
    description: Optional[Union[str, undefined]] = Field(description="Human-readable description")
    required: Optional[Union[bool, undefined]] = Field(description="Whether argument is required")


class Prompt(BaseModel):
    """
Prompt Definition - a reusable prompt template"""
    model_config = ConfigDict(extra='allow')

    name: str = Field(description="Unique prompt name")
    description: Optional[Union[str, undefined]] = Field(description="Human-readable description")
    arguments: Optional[Union[List[import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").PromptArgument], undefined]] = Field(description="Prompt arguments")


class PromptsCapability(BaseModel):
    """
Prompts Capability"""
    model_config = ConfigDict(extra='allow')

    listChanged: Optional[Union[bool, undefined]] = Field(description="Server supports list_changed notifications")


class GetPromptParams(BaseModel):
    """
Get Prompt Parameters"""
    model_config = ConfigDict(extra='allow')

    name: str = Field(description="Prompt name")
    arguments: Optional[Union[Dict[str, str], undefined]] = Field(description="Prompt arguments")


class PromptMessage(BaseModel):
    """
Prompt Message - a message in a prompt conversation"""
    model_config = ConfigDict(extra='allow')

    role: Union["user", "assistant", "system"] = Field(description="Role")
    content: import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").PromptMessageContent = Field(description="Message content")


class TextPromptContent(BaseModel):
    """"""
    model_config = ConfigDict(extra='allow')

    type: "text"
    text: str


class ImagePromptContent(BaseModel):
    """"""
    model_config = ConfigDict(extra='allow')

    type: "image"
    data: str
    mimeType: str


class AudioPromptContent(BaseModel):
    """"""
    model_config = ConfigDict(extra='allow')

    type: "audio"
    data: str
    mimeType: str


class ResourcePromptContent(BaseModel):
    """"""
    model_config = ConfigDict(extra='allow')

    type: "resource"
    resource: import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ResourceContents


class GetPromptResult(BaseModel):
    """
Get Prompt Result"""
    model_config = ConfigDict(extra='allow')

    description: Optional[Union[str, undefined]] = Field(description="Prompt description")
    messages: List[import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").PromptMessage] = Field(description="Prompt messages")


class LoggingCapability(BaseModel):
    """
Logging Capability"""
    model_config = ConfigDict(extra='allow')

    levels: Optional[Union[List[import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").LogLevel], undefined]] = Field(description="Supported log levels")


class SetLogLevelParams(BaseModel):
    """
Set Log Level Parameters"""
    model_config = ConfigDict(extra='allow')

    level: import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").LogLevel = Field(description="Log level")


class LogMessageNotification(BaseModel):
    """
Log Message Notification"""
    model_config = ConfigDict(extra='allow')

    level: import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").LogLevel = Field(description="Log level")
    logger: Optional[Union[str, undefined]] = Field(description="Logger name")
    message: str = Field(description="Log message")
    data: Optional[Any] = Field(description="Additional data")


class PaginationParams(BaseModel):
    """
Pagination Parameters"""
    model_config = ConfigDict(extra='allow')

    cursor: Optional[Union[str, undefined]] = Field(description="Cursor for next page")
    limit: Optional[Union[float, undefined]] = Field(description="Maximum items per page")


class PaginatedResult(BaseModel):
    """
Paginated Result"""
    model_config = ConfigDict(extra='allow')

    items: List[T] = Field(description="Items")
    nextCursor: Optional[Union[str, undefined]] = Field(description="Next cursor")
    total: Optional[Union[float, undefined]] = Field(description="Total count (if available)")


class InitializeParams(BaseModel):
    """
Initialize Request Parameters"""
    model_config = ConfigDict(extra='allow')

    protocolVersion: str = Field(description="Protocol version client supports")
    capabilities: import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ClientCapabilities = Field(description="Client capabilities")
    clientInfo: import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ImplementationInfo = Field(description="Client info")


class InitializeResult(BaseModel):
    """
Initialize Response Result"""
    model_config = ConfigDict(extra='allow')

    protocolVersion: str = Field(description="Negotiated protocol version")
    capabilities: import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ServerCapabilities = Field(description="Server capabilities")
    serverInfo: import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ImplementationInfo = Field(description="Server info")
    instructions: Optional[Union[str, undefined]] = Field(description="Instructions for the client")


class ImplementationInfo(BaseModel):
    """
Implementation Information"""
    model_config = ConfigDict(extra='allow')

    name: str = Field(description="Implementation name")
    version: str = Field(description="Implementation version")
    metadata: Optional[Union[Dict[str, Any], undefined]] = Field(description="Implementation metadata")


class CompleteParams(BaseModel):
    """
Completion Request Parameters"""
    model_config = ConfigDict(extra='allow')

    ref: import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").CompletionReference = Field(description="Reference to complete")
    argument: import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").CompletionArgument = Field(description="Argument to complete")


class ToolCompletionReference(BaseModel):
    """"""
    model_config = ConfigDict(extra='allow')

    type: "ref/tool"
    name: str


class PromptCompletionReference(BaseModel):
    """"""
    model_config = ConfigDict(extra='allow')

    type: "ref/prompt"
    name: str


class ResourceCompletionReference(BaseModel):
    """"""
    model_config = ConfigDict(extra='allow')

    type: "ref/resource"
    uri: str


class CompletionArgument(BaseModel):
    """
Completion Argument"""
    model_config = ConfigDict(extra='allow')

    name: str = Field(description="Argument name")
    value: str = Field(description="Current value")


class CompleteResult(BaseModel):
    """
Completion Result"""
    model_config = ConfigDict(extra='allow')

    completion: import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").CompletionSuggestion = Field(description="Completion suggestions")


class CompletionSuggestion(BaseModel):
    """"""
    model_config = ConfigDict(extra='allow')

    values: List[str] = Field(description="Suggested values")
    total: Optional[Union[float, undefined]] = Field(description="Total available (if known)")
    hasMore: Optional[Union[bool, undefined]] = Field(description="Whether there are more values")


class Root(BaseModel):
    """
Root Definition - a filesystem root the client exposes"""
    model_config = ConfigDict(extra='allow')

    uri: str = Field(description="Root URI")
    name: Optional[Union[str, undefined]] = Field(description="Human-readable name")


class ListRootsResult(BaseModel):
    """
List Roots Result"""
    model_config = ConfigDict(extra='allow')

    roots: List[import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").Root] = Field(description="Roots")


class RootsListChangedNotification(BaseModel):
    """
Roots List Changed Notification"""
    model_config = ConfigDict(extra='allow')



class CreateMessageParams(BaseModel):
    """
Sampling Request Parameters"""
    model_config = ConfigDict(extra='allow')

    messages: List[import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").SamplingMessage] = Field(description="Messages to sample from")
    modelPreferences: Optional[Union[import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ModelPreferences, undefined]] = Field(description="Model preferences")
    systemPrompt: Optional[Union[str, undefined]] = Field(description="System prompt")
    includeContext: Optional[Union["none", "thisServer", "allServers", undefined]] = Field(description="Include context")
    temperature: Optional[Union[float, undefined]] = Field(description="Temperature")
    maxTokens: float = Field(description="Max tokens")
    stopSequences: Optional[Union[List[str], undefined]] = Field(description="Stop sequences")
    metadata: Optional[Union[Dict[str, Any], undefined]] = Field(description="Metadata")


class ModelPreferences(BaseModel):
    """
Model Preferences"""
    model_config = ConfigDict(extra='allow')

    hints: Optional[Union[List[import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ModelHint], undefined]] = Field(description="Hints for model selection")
    costPriority: Optional[Union[float, undefined]] = Field(description="Cost priority (0-1)")
    speedPriority: Optional[Union[float, undefined]] = Field(description="Speed priority (0-1)")
    intelligencePriority: Optional[Union[float, undefined]] = Field(description="Intelligence priority (0-1)")


class ModelHint(BaseModel):
    """"""
    model_config = ConfigDict(extra='allow')

    name: Optional[Union[str, undefined]] = Field(description="Model name hint")


class SamplingMessage(BaseModel):
    """
Sampling Message"""
    model_config = ConfigDict(extra='allow')

    role: Union["user", "assistant"] = Field(description="Role")
    content: import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").PromptMessageContent = Field(description="Content")


class CreateMessageResult(BaseModel):
    """
Create Message Result"""
    model_config = ConfigDict(extra='allow')

    message: import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").SamplingMessage = Field(description="Sampled message")
    model: str = Field(description="Model used")
    stopReason: Optional[Union["error", "endTurn", "stopSequence", "maxTokens", undefined]] = Field(description="Stop reason")


class MCPRequestParams(BaseModel):
    """
Request Parameter Types by Method"""
    model_config = ConfigDict(extra='allow')

    initialize: import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").InitializeParams
    'tools/list': import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").PaginationParams
    'tools/call': import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").CallToolParams
    'resources/list': import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").PaginationParams
    'resources/templates/list': import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").PaginationParams
    'resources/read': import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ReadResourceParams
    'resources/subscribe': import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").SubscribeResourceParams
    'resources/unsubscribe': import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").UnsubscribeResourceParams
    'prompts/list': import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").PaginationParams
    'prompts/get': import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").GetPromptParams
    'completion/complete': import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").CompleteParams
    'logging/setLevel': import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").SetLogLevelParams
    'roots/list': Record<string, never>
    'sampling/createMessage': import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").CreateMessageParams


class MCPResponseResults(BaseModel):
    """
Response Result Types by Method"""
    model_config = ConfigDict(extra='allow')

    initialize: import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").InitializeResult
    'tools/list': Union[{ tools: import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").Tool[]; nextCursor?: string, undefined; }]
    'tools/call': import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").CallToolResult
    'resources/list': Union[{ resources: import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").Resource[]; nextCursor?: string, undefined; }]
    'resources/templates/list': Union[{ resourceTemplates: import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ResourceTemplate[]; nextCursor?: string, undefined; }]
    'resources/read': { contents: import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ResourceContents[]; }
    'resources/subscribe': Record<string, never>
    'resources/unsubscribe': Record<string, never>
    'prompts/list': Union[{ prompts: import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").Prompt[]; nextCursor?: string, undefined; }]
    'prompts/get': import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").GetPromptResult
    'completion/complete': import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").CompleteResult
    'logging/setLevel': Record<string, never>
    'roots/list': import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ListRootsResult
    'sampling/createMessage': import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").CreateMessageResult


class MCPNotificationParams(BaseModel):
    """
Notification Parameter Types"""
    model_config = ConfigDict(extra='allow')

    'notifications/tools/list_changed': Record<string, never>
    'notifications/resources/list_changed': Record<string, never>
    'notifications/resources/updated': import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ResourceUpdatedNotification
    'notifications/prompts/list_changed': Record<string, never>
    'notifications/roots/list_changed': import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").RootsListChangedNotification
    'notifications/message': import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").LogMessageNotification
    'notifications/log': import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").LogMessageNotification


# ============================================================================
# Utility Functions
# ============================================================================

def validate_tool_result(data: Dict[str, Any]) -> bool:
    """Validate tool result structure."""
    return 'content' in data

def validate_resource_contents(data: Dict[str, Any]) -> bool:
    """Validate resource contents structure."""
    return 'uri' in data and 'mimeType' in data

# ============================================================================
# Type Adapters for JSON Schema Generation
# ============================================================================

JSONSchemaAdapter = TypeAdapter(JSONSchema)
DiscriminatorAdapter = TypeAdapter(Discriminator)
ExternalDocumentationAdapter = TypeAdapter(ExternalDocumentation)
MCPMessageAdapter = TypeAdapter(MCPMessage)
MCPErrorAdapter = TypeAdapter(MCPError)
ClientCapabilitiesAdapter = TypeAdapter(ClientCapabilities)
ServerCapabilitiesAdapter = TypeAdapter(ServerCapabilities)
ToolAnnotationsAdapter = TypeAdapter(ToolAnnotations)
ToolAdapter = TypeAdapter(Tool)
ToolsCapabilityAdapter = TypeAdapter(ToolsCapability)
CallToolParamsAdapter = TypeAdapter(CallToolParams)
CallToolResultAdapter = TypeAdapter(CallToolResult)
TextContentAdapter = TypeAdapter(TextContent)
ImageContentAdapter = TypeAdapter(ImageContent)
AudioContentAdapter = TypeAdapter(AudioContent)
ResourceLinkContentAdapter = TypeAdapter(ResourceLinkContent)
EmbeddedResourceContentAdapter = TypeAdapter(EmbeddedResourceContent)
ResourceAnnotationsAdapter = TypeAdapter(ResourceAnnotations)
ResourceAdapter = TypeAdapter(Resource)
ResourcesCapabilityAdapter = TypeAdapter(ResourcesCapability)
ResourceContentsAdapter = TypeAdapter(ResourceContents)
ReadResourceParamsAdapter = TypeAdapter(ReadResourceParams)
ResourceTemplateAdapter = TypeAdapter(ResourceTemplate)
SubscribeResourceParamsAdapter = TypeAdapter(SubscribeResourceParams)
UnsubscribeResourceParamsAdapter = TypeAdapter(UnsubscribeResourceParams)
ResourceUpdatedNotificationAdapter = TypeAdapter(ResourceUpdatedNotification)
PromptArgumentAdapter = TypeAdapter(PromptArgument)
PromptAdapter = TypeAdapter(Prompt)
PromptsCapabilityAdapter = TypeAdapter(PromptsCapability)
GetPromptParamsAdapter = TypeAdapter(GetPromptParams)
PromptMessageAdapter = TypeAdapter(PromptMessage)
TextPromptContentAdapter = TypeAdapter(TextPromptContent)
ImagePromptContentAdapter = TypeAdapter(ImagePromptContent)
AudioPromptContentAdapter = TypeAdapter(AudioPromptContent)
ResourcePromptContentAdapter = TypeAdapter(ResourcePromptContent)
GetPromptResultAdapter = TypeAdapter(GetPromptResult)
LoggingCapabilityAdapter = TypeAdapter(LoggingCapability)
SetLogLevelParamsAdapter = TypeAdapter(SetLogLevelParams)
LogMessageNotificationAdapter = TypeAdapter(LogMessageNotification)
PaginationParamsAdapter = TypeAdapter(PaginationParams)
PaginatedResultAdapter = TypeAdapter(PaginatedResult)
InitializeParamsAdapter = TypeAdapter(InitializeParams)
InitializeResultAdapter = TypeAdapter(InitializeResult)
ImplementationInfoAdapter = TypeAdapter(ImplementationInfo)
CompleteParamsAdapter = TypeAdapter(CompleteParams)
ToolCompletionReferenceAdapter = TypeAdapter(ToolCompletionReference)
PromptCompletionReferenceAdapter = TypeAdapter(PromptCompletionReference)
ResourceCompletionReferenceAdapter = TypeAdapter(ResourceCompletionReference)
CompletionArgumentAdapter = TypeAdapter(CompletionArgument)
CompleteResultAdapter = TypeAdapter(CompleteResult)
CompletionSuggestionAdapter = TypeAdapter(CompletionSuggestion)
RootAdapter = TypeAdapter(Root)
ListRootsResultAdapter = TypeAdapter(ListRootsResult)
RootsListChangedNotificationAdapter = TypeAdapter(RootsListChangedNotification)
CreateMessageParamsAdapter = TypeAdapter(CreateMessageParams)
ModelPreferencesAdapter = TypeAdapter(ModelPreferences)
ModelHintAdapter = TypeAdapter(ModelHint)
SamplingMessageAdapter = TypeAdapter(SamplingMessage)
CreateMessageResultAdapter = TypeAdapter(CreateMessageResult)
MCPRequestParamsAdapter = TypeAdapter(MCPRequestParams)
MCPResponseResultsAdapter = TypeAdapter(MCPResponseResults)
MCPNotificationParamsAdapter = TypeAdapter(MCPNotificationParams)

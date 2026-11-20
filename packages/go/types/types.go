// Package types provides Go MCP protocol types
// Auto-generated from spec/protocol/mcp-core.ts
// DO NOT EDIT MANUALLY

package types

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/go-playground/validator/v10"
	"github.com/xeipuuv/gojsonschema"
)

var validate = validator.New()

// ============================================================================
// Branded Types
// ============================================================================

type ServerID string
type ToolName string
type ResourceURI string
type PromptName string
type ConnectionID string
type RequestID string

func NewServerID(v string) ServerID      { return ServerID(v) }
func NewToolName(v string) ToolName      { return ToolName(v) }
func NewResourceURI(v string) ResourceURI { return ResourceURI(v) }
func NewPromptName(v string) PromptName   { return PromptName(v) }
func NewConnectionID(v string) ConnectionID { return ConnectionID(v) }
func NewRequestID(v string) RequestID     { return RequestID(v) }

// ============================================================================
// JSON Schema
// ============================================================================

type JSONSchema map[string]interface{}

// ValidateJSONSchema validates a JSON schema using gojsonschema
func ValidateJSONSchema(schema JSONSchema) error {
	sl := gojsonschema.NewGoLoader(schema)
	_, err := gojsonschema.NewSchema(sl)
	return err
}

// ============================================================================
// Protocol Types
// ============================================================================
// 
JSON Schema Draft 2020-12 compatible type
Used for tool input/output schemas and resource schemas
type JSONSchema struct {
	type interface{} `json:"type,omitempty" validate:"omitempty"`
	title interface{} `json:"title,omitempty" validate:"omitempty"`
	description interface{} `json:"description,omitempty" validate:"omitempty"`
	default interface{} `json:"default,omitempty" validate:"omitempty"`
	examples interface{} `json:"examples,omitempty" validate:"omitempty"`
	multipleOf interface{} `json:"multipleOf,omitempty" validate:"omitempty"`
	maximum interface{} `json:"maximum,omitempty" validate:"omitempty"`
	exclusiveMaximum interface{} `json:"exclusiveMaximum,omitempty" validate:"omitempty"`
	minimum interface{} `json:"minimum,omitempty" validate:"omitempty"`
	exclusiveMinimum interface{} `json:"exclusiveMinimum,omitempty" validate:"omitempty"`
	maxLength interface{} `json:"maxLength,omitempty" validate:"omitempty"`
	minLength interface{} `json:"minLength,omitempty" validate:"omitempty"`
	pattern interface{} `json:"pattern,omitempty" validate:"omitempty"`
	format interface{} `json:"format,omitempty" validate:"omitempty"`
	maxItems interface{} `json:"maxItems,omitempty" validate:"omitempty"`
	minItems interface{} `json:"minItems,omitempty" validate:"omitempty"`
	uniqueItems interface{} `json:"uniqueItems,omitempty" validate:"omitempty"`
	items interface{} `json:"items,omitempty" validate:"omitempty"`
	maxProperties interface{} `json:"maxProperties,omitempty" validate:"omitempty"`
	minProperties interface{} `json:"minProperties,omitempty" validate:"omitempty"`
	required interface{} `json:"required,omitempty" validate:"omitempty"`
	properties interface{} `json:"properties,omitempty" validate:"omitempty"`
	patternProperties interface{} `json:"patternProperties,omitempty" validate:"omitempty"`
	additionalProperties interface{} `json:"additionalProperties,omitempty" validate:"omitempty"`
	allOf interface{} `json:"allOf,omitempty" validate:"omitempty"`
	anyOf interface{} `json:"anyOf,omitempty" validate:"omitempty"`
	oneOf interface{} `json:"oneOf,omitempty" validate:"omitempty"`
	not interface{} `json:"not,omitempty" validate:"omitempty"`
	$ref interface{} `json:"$ref,omitempty" validate:"omitempty"`
	$defs interface{} `json:"$defs,omitempty" validate:"omitempty"`
	$schema interface{} `json:"$schema,omitempty" validate:"omitempty"`
	const interface{} `json:"const,omitempty" validate:"omitempty"`
	enum interface{} `json:"enum,omitempty" validate:"omitempty"`
	discriminator interface{} `json:"discriminator,omitempty" validate:"omitempty"`
	externalDocs interface{} `json:"externalDocs,omitempty" validate:"omitempty"`
	nullable interface{} `json:"nullable,omitempty" validate:"omitempty"`
	readOnly interface{} `json:"readOnly,omitempty" validate:"omitempty"`
	writeOnly interface{} `json:"writeOnly,omitempty" validate:"omitempty"`
	deprecated interface{} `json:"deprecated,omitempty" validate:"omitempty"`
}

func (j *JSONSchema) Validate() error {
	return validate.Struct(j)
}

// 
type Discriminator struct {
	propertyName string `json:"propertyName,required" validate:"required"`
	mapping interface{} `json:"mapping,omitempty" validate:"omitempty"`
}

func (d *Discriminator) Validate() error {
	return validate.Struct(d)
}

// 
type ExternalDocumentation struct {
	description interface{} `json:"description,omitempty" validate:"omitempty"`
	url string `json:"url,required" validate:"required"`
}

func (e *ExternalDocumentation) Validate() error {
	return validate.Struct(e)
}

// 
JSON-RPC 2.0 Message Envelope
All MCP communication uses JSON-RPC 2.0 framing
type MCPMessage struct {
	jsonrpc "2.0" `json:"jsonrpc,required" validate:"required"`
	id interface{} `json:"id,omitempty" validate:"omitempty"`
	method interface{} `json:"method,omitempty" validate:"omitempty"`
	params interface{} `json:"params,omitempty" validate:"omitempty"`
	result interface{} `json:"result,omitempty" validate:"omitempty"`
	error interface{} `json:"error,omitempty" validate:"omitempty"`
}

func (m *MCPMessage) Validate() error {
	return validate.Struct(m)
}

// 
MCP Error Structure (JSON-RPC 2.0 compatible)
type MCPError struct {
	code float64 `json:"code,required" validate:"required"`
	message string `json:"message,required" validate:"required"`
	data interface{} `json:"data,omitempty" validate:"omitempty"`
}

func (m *MCPError) Validate() error {
	return validate.Struct(m)
}

// 
Client Capabilities - what the client supports
type ClientCapabilities struct {
	tools interface{} `json:"tools,omitempty" validate:"omitempty"`
	resources interface{} `json:"resources,omitempty" validate:"omitempty"`
	prompts interface{} `json:"prompts,omitempty" validate:"omitempty"`
	experimental interface{} `json:"experimental,omitempty" validate:"omitempty"`
}

func (c *ClientCapabilities) Validate() error {
	return validate.Struct(c)
}

// 
Server Capabilities - what the server provides
type ServerCapabilities struct {
	tools interface{} `json:"tools,omitempty" validate:"omitempty"`
	resources interface{} `json:"resources,omitempty" validate:"omitempty"`
	prompts interface{} `json:"prompts,omitempty" validate:"omitempty"`
	logging interface{} `json:"logging,omitempty" validate:"omitempty"`
	experimental interface{} `json:"experimental,omitempty" validate:"omitempty"`
}

func (s *ServerCapabilities) Validate() error {
	return validate.Struct(s)
}

// 
Tool Annotations - metadata about tool behavior
type ToolAnnotations struct {
	readOnly interface{} `json:"readOnly,omitempty" validate:"omitempty"`
	idempotent interface{} `json:"idempotent,omitempty" validate:"omitempty"`
	destructive interface{} `json:"destructive,omitempty" validate:"omitempty"`
	estimatedDurationMs interface{} `json:"estimatedDurationMs,omitempty" validate:"omitempty"`
	requiredPermissions interface{} `json:"requiredPermissions,omitempty" validate:"omitempty"`
}

func (t *ToolAnnotations) Validate() error {
	return validate.Struct(t)
}

// 
Tool Definition - a callable function exposed by the server
type Tool struct {
	name string `json:"name,required" validate:"required"`
	description string `json:"description,required" validate:"required"`
	inputSchema import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").JSONSchema `json:"inputSchema,required" validate:"required"`
	outputSchema interface{} `json:"outputSchema,omitempty" validate:"omitempty"`
	annotations interface{} `json:"annotations,omitempty" validate:"omitempty"`
}

func (t *Tool) Validate() error {
	return validate.Struct(t)
}

// 
Tools Capability
type ToolsCapability struct {
	listChanged interface{} `json:"listChanged,omitempty" validate:"omitempty"`
}

func (t *ToolsCapability) Validate() error {
	return validate.Struct(t)
}

// 
Tool Call Request Parameters
type CallToolParams struct {
	name string `json:"name,required" validate:"required"`
	arguments map[string]interface{} `json:"arguments,required" validate:"required"`
}

func (c *CallToolParams) Validate() error {
	return validate.Struct(c)
}

// 
Tool Call Result
type CallToolResult struct {
	content []import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ToolResultContent `json:"content,required" validate:"required"`
	isError interface{} `json:"isError,omitempty" validate:"omitempty"`
	structuredContent interface{} `json:"structuredContent,omitempty" validate:"omitempty"`
}

func (c *CallToolResult) Validate() error {
	return validate.Struct(c)
}

// 
type TextContent struct {
	type "text" `json:"type,required" validate:"required"`
	text string `json:"text,required" validate:"required"`
	annotations interface{} `json:"annotations,omitempty" validate:"omitempty"`
}

func (t *TextContent) Validate() error {
	return validate.Struct(t)
}

// 
type ImageContent struct {
	type "image" `json:"type,required" validate:"required"`
	data string `json:"data,required" validate:"required"`
	mimeType string `json:"mimeType,required" validate:"required"`
	annotations interface{} `json:"annotations,omitempty" validate:"omitempty"`
}

func (i *ImageContent) Validate() error {
	return validate.Struct(i)
}

// 
type AudioContent struct {
	type "audio" `json:"type,required" validate:"required"`
	data string `json:"data,required" validate:"required"`
	mimeType string `json:"mimeType,required" validate:"required"`
	annotations interface{} `json:"annotations,omitempty" validate:"omitempty"`
}

func (a *AudioContent) Validate() error {
	return validate.Struct(a)
}

// 
type ResourceLinkContent struct {
	type "resource_link" `json:"type,required" validate:"required"`
	uri string `json:"uri,required" validate:"required"`
	name interface{} `json:"name,omitempty" validate:"omitempty"`
	description interface{} `json:"description,omitempty" validate:"omitempty"`
	mimeType interface{} `json:"mimeType,omitempty" validate:"omitempty"`
	annotations interface{} `json:"annotations,omitempty" validate:"omitempty"`
}

func (r *ResourceLinkContent) Validate() error {
	return validate.Struct(r)
}

// 
type EmbeddedResourceContent struct {
	type "resource" `json:"type,required" validate:"required"`
	resource import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ResourceContents `json:"resource,required" validate:"required"`
	annotations interface{} `json:"annotations,omitempty" validate:"omitempty"`
}

func (e *EmbeddedResourceContent) Validate() error {
	return validate.Struct(e)
}

// 
Resource Annotations - metadata about resource
type ResourceAnnotations struct {
	readOnly interface{} `json:"readOnly,omitempty" validate:"omitempty"`
	size interface{} `json:"size,omitempty" validate:"omitempty"`
	lastModified interface{} `json:"lastModified,omitempty" validate:"omitempty"`
}

func (r *ResourceAnnotations) Validate() error {
	return validate.Struct(r)
}

// 
Resource Definition - a readable data source
type Resource struct {
	uri string `json:"uri,required" validate:"required"`
	name string `json:"name,required" validate:"required"`
	description interface{} `json:"description,omitempty" validate:"omitempty"`
	mimeType interface{} `json:"mimeType,omitempty" validate:"omitempty"`
	annotations interface{} `json:"annotations,omitempty" validate:"omitempty"`
}

func (r *Resource) Validate() error {
	return validate.Struct(r)
}

// 
Resources Capability
type ResourcesCapability struct {
	subscribe interface{} `json:"subscribe,omitempty" validate:"omitempty"`
	listChanged interface{} `json:"listChanged,omitempty" validate:"omitempty"`
}

func (r *ResourcesCapability) Validate() error {
	return validate.Struct(r)
}

// 
Resource Contents - actual resource data
type ResourceContents struct {
	uri string `json:"uri,required" validate:"required"`
	mimeType string `json:"mimeType,required" validate:"required"`
	text interface{} `json:"text,omitempty" validate:"omitempty"`
	blob interface{} `json:"blob,omitempty" validate:"omitempty"`
}

func (r *ResourceContents) Validate() error {
	return validate.Struct(r)
}

// 
Read Resource Parameters
type ReadResourceParams struct {
	uri string `json:"uri,required" validate:"required"`
}

func (r *ReadResourceParams) Validate() error {
	return validate.Struct(r)
}

// 
Resource Template - for dynamic resource discovery
type ResourceTemplate struct {
	uriTemplate string `json:"uriTemplate,required" validate:"required"`
	name string `json:"name,required" validate:"required"`
	description interface{} `json:"description,omitempty" validate:"omitempty"`
	mimeType interface{} `json:"mimeType,omitempty" validate:"omitempty"`
	annotations interface{} `json:"annotations,omitempty" validate:"omitempty"`
}

func (r *ResourceTemplate) Validate() error {
	return validate.Struct(r)
}

// 
Subscribe Resource Parameters
type SubscribeResourceParams struct {
	uri string `json:"uri,required" validate:"required"`
}

func (s *SubscribeResourceParams) Validate() error {
	return validate.Struct(s)
}

// 
Unsubscribe Resource Parameters
type UnsubscribeResourceParams struct {
	uri string `json:"uri,required" validate:"required"`
}

func (u *UnsubscribeResourceParams) Validate() error {
	return validate.Struct(u)
}

// 
Resource Updated Notification
type ResourceUpdatedNotification struct {
	uri string `json:"uri,required" validate:"required"`
}

func (r *ResourceUpdatedNotification) Validate() error {
	return validate.Struct(r)
}

// 
Prompt Argument Definition
type PromptArgument struct {
	name string `json:"name,required" validate:"required"`
	description interface{} `json:"description,omitempty" validate:"omitempty"`
	required interface{} `json:"required,omitempty" validate:"omitempty"`
}

func (p *PromptArgument) Validate() error {
	return validate.Struct(p)
}

// 
Prompt Definition - a reusable prompt template
type Prompt struct {
	name string `json:"name,required" validate:"required"`
	description interface{} `json:"description,omitempty" validate:"omitempty"`
	arguments interface{} `json:"arguments,omitempty" validate:"omitempty"`
}

func (p *Prompt) Validate() error {
	return validate.Struct(p)
}

// 
Prompts Capability
type PromptsCapability struct {
	listChanged interface{} `json:"listChanged,omitempty" validate:"omitempty"`
}

func (p *PromptsCapability) Validate() error {
	return validate.Struct(p)
}

// 
Get Prompt Parameters
type GetPromptParams struct {
	name string `json:"name,required" validate:"required"`
	arguments interface{} `json:"arguments,omitempty" validate:"omitempty"`
}

func (g *GetPromptParams) Validate() error {
	return validate.Struct(g)
}

// 
Prompt Message - a message in a prompt conversation
type PromptMessage struct {
	role interface{} `json:"role,required" validate:"required"`
	content import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").PromptMessageContent `json:"content,required" validate:"required"`
}

func (p *PromptMessage) Validate() error {
	return validate.Struct(p)
}

// 
type TextPromptContent struct {
	type "text" `json:"type,required" validate:"required"`
	text string `json:"text,required" validate:"required"`
}

func (t *TextPromptContent) Validate() error {
	return validate.Struct(t)
}

// 
type ImagePromptContent struct {
	type "image" `json:"type,required" validate:"required"`
	data string `json:"data,required" validate:"required"`
	mimeType string `json:"mimeType,required" validate:"required"`
}

func (i *ImagePromptContent) Validate() error {
	return validate.Struct(i)
}

// 
type AudioPromptContent struct {
	type "audio" `json:"type,required" validate:"required"`
	data string `json:"data,required" validate:"required"`
	mimeType string `json:"mimeType,required" validate:"required"`
}

func (a *AudioPromptContent) Validate() error {
	return validate.Struct(a)
}

// 
type ResourcePromptContent struct {
	type "resource" `json:"type,required" validate:"required"`
	resource import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ResourceContents `json:"resource,required" validate:"required"`
}

func (r *ResourcePromptContent) Validate() error {
	return validate.Struct(r)
}

// 
Get Prompt Result
type GetPromptResult struct {
	description interface{} `json:"description,omitempty" validate:"omitempty"`
	messages []import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").PromptMessage `json:"messages,required" validate:"required"`
}

func (g *GetPromptResult) Validate() error {
	return validate.Struct(g)
}

// 
Logging Capability
type LoggingCapability struct {
	levels interface{} `json:"levels,omitempty" validate:"omitempty"`
}

func (l *LoggingCapability) Validate() error {
	return validate.Struct(l)
}

// 
Set Log Level Parameters
type SetLogLevelParams struct {
	level import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").LogLevel `json:"level,required" validate:"required"`
}

func (s *SetLogLevelParams) Validate() error {
	return validate.Struct(s)
}

// 
Log Message Notification
type LogMessageNotification struct {
	level import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").LogLevel `json:"level,required" validate:"required"`
	logger interface{} `json:"logger,omitempty" validate:"omitempty"`
	message string `json:"message,required" validate:"required"`
	data interface{} `json:"data,omitempty" validate:"omitempty"`
}

func (l *LogMessageNotification) Validate() error {
	return validate.Struct(l)
}

// 
Pagination Parameters
type PaginationParams struct {
	cursor interface{} `json:"cursor,omitempty" validate:"omitempty"`
	limit interface{} `json:"limit,omitempty" validate:"omitempty"`
}

func (p *PaginationParams) Validate() error {
	return validate.Struct(p)
}

// 
Paginated Result
type PaginatedResult struct {
	items []T `json:"items,required" validate:"required"`
	nextCursor interface{} `json:"nextCursor,omitempty" validate:"omitempty"`
	total interface{} `json:"total,omitempty" validate:"omitempty"`
}

func (p *PaginatedResult) Validate() error {
	return validate.Struct(p)
}

// 
Initialize Request Parameters
type InitializeParams struct {
	protocolVersion string `json:"protocolVersion,required" validate:"required"`
	capabilities import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ClientCapabilities `json:"capabilities,required" validate:"required"`
	clientInfo import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ImplementationInfo `json:"clientInfo,required" validate:"required"`
}

func (i *InitializeParams) Validate() error {
	return validate.Struct(i)
}

// 
Initialize Response Result
type InitializeResult struct {
	protocolVersion string `json:"protocolVersion,required" validate:"required"`
	capabilities import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ServerCapabilities `json:"capabilities,required" validate:"required"`
	serverInfo import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ImplementationInfo `json:"serverInfo,required" validate:"required"`
	instructions interface{} `json:"instructions,omitempty" validate:"omitempty"`
}

func (i *InitializeResult) Validate() error {
	return validate.Struct(i)
}

// 
Implementation Information
type ImplementationInfo struct {
	name string `json:"name,required" validate:"required"`
	version string `json:"version,required" validate:"required"`
	metadata interface{} `json:"metadata,omitempty" validate:"omitempty"`
}

func (i *ImplementationInfo) Validate() error {
	return validate.Struct(i)
}

// 
Completion Request Parameters
type CompleteParams struct {
	ref import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").CompletionReference `json:"ref,required" validate:"required"`
	argument import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").CompletionArgument `json:"argument,required" validate:"required"`
}

func (c *CompleteParams) Validate() error {
	return validate.Struct(c)
}

// 
type ToolCompletionReference struct {
	type "ref/tool" `json:"type,required" validate:"required"`
	name string `json:"name,required" validate:"required"`
}

func (t *ToolCompletionReference) Validate() error {
	return validate.Struct(t)
}

// 
type PromptCompletionReference struct {
	type "ref/prompt" `json:"type,required" validate:"required"`
	name string `json:"name,required" validate:"required"`
}

func (p *PromptCompletionReference) Validate() error {
	return validate.Struct(p)
}

// 
type ResourceCompletionReference struct {
	type "ref/resource" `json:"type,required" validate:"required"`
	uri string `json:"uri,required" validate:"required"`
}

func (r *ResourceCompletionReference) Validate() error {
	return validate.Struct(r)
}

// 
Completion Argument
type CompletionArgument struct {
	name string `json:"name,required" validate:"required"`
	value string `json:"value,required" validate:"required"`
}

func (c *CompletionArgument) Validate() error {
	return validate.Struct(c)
}

// 
Completion Result
type CompleteResult struct {
	completion import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").CompletionSuggestion `json:"completion,required" validate:"required"`
}

func (c *CompleteResult) Validate() error {
	return validate.Struct(c)
}

// 
type CompletionSuggestion struct {
	values []string `json:"values,required" validate:"required"`
	total interface{} `json:"total,omitempty" validate:"omitempty"`
	hasMore interface{} `json:"hasMore,omitempty" validate:"omitempty"`
}

func (c *CompletionSuggestion) Validate() error {
	return validate.Struct(c)
}

// 
Root Definition - a filesystem root the client exposes
type Root struct {
	uri string `json:"uri,required" validate:"required"`
	name interface{} `json:"name,omitempty" validate:"omitempty"`
}

func (r *Root) Validate() error {
	return validate.Struct(r)
}

// 
List Roots Result
type ListRootsResult struct {
	roots []import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").Root `json:"roots,required" validate:"required"`
}

func (l *ListRootsResult) Validate() error {
	return validate.Struct(l)
}

// 
Roots List Changed Notification
type RootsListChangedNotification struct {
}

func (r *RootsListChangedNotification) Validate() error {
	return validate.Struct(r)
}

// 
Sampling Request Parameters
type CreateMessageParams struct {
	messages []import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").SamplingMessage `json:"messages,required" validate:"required"`
	modelPreferences interface{} `json:"modelPreferences,omitempty" validate:"omitempty"`
	systemPrompt interface{} `json:"systemPrompt,omitempty" validate:"omitempty"`
	includeContext interface{} `json:"includeContext,omitempty" validate:"omitempty"`
	temperature interface{} `json:"temperature,omitempty" validate:"omitempty"`
	maxTokens float64 `json:"maxTokens,required" validate:"required"`
	stopSequences interface{} `json:"stopSequences,omitempty" validate:"omitempty"`
	metadata interface{} `json:"metadata,omitempty" validate:"omitempty"`
}

func (c *CreateMessageParams) Validate() error {
	return validate.Struct(c)
}

// 
Model Preferences
type ModelPreferences struct {
	hints interface{} `json:"hints,omitempty" validate:"omitempty"`
	costPriority interface{} `json:"costPriority,omitempty" validate:"omitempty"`
	speedPriority interface{} `json:"speedPriority,omitempty" validate:"omitempty"`
	intelligencePriority interface{} `json:"intelligencePriority,omitempty" validate:"omitempty"`
}

func (m *ModelPreferences) Validate() error {
	return validate.Struct(m)
}

// 
type ModelHint struct {
	name interface{} `json:"name,omitempty" validate:"omitempty"`
}

func (m *ModelHint) Validate() error {
	return validate.Struct(m)
}

// 
Sampling Message
type SamplingMessage struct {
	role interface{} `json:"role,required" validate:"required"`
	content import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").PromptMessageContent `json:"content,required" validate:"required"`
}

func (s *SamplingMessage) Validate() error {
	return validate.Struct(s)
}

// 
Create Message Result
type CreateMessageResult struct {
	message import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").SamplingMessage `json:"message,required" validate:"required"`
	model string `json:"model,required" validate:"required"`
	stopReason interface{} `json:"stopReason,omitempty" validate:"omitempty"`
}

func (c *CreateMessageResult) Validate() error {
	return validate.Struct(c)
}

// 
Request Parameter Types by Method
type MCPRequestParams struct {
	initialize import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").InitializeParams `json:"initialize,required" validate:"required"`
	'tools/list' import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").PaginationParams `json:"'tools/list',required" validate:"required"`
	'tools/call' import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").CallToolParams `json:"'tools/call',required" validate:"required"`
	'resources/list' import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").PaginationParams `json:"'resources/list',required" validate:"required"`
	'resources/templates/list' import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").PaginationParams `json:"'resources/templates/list',required" validate:"required"`
	'resources/read' import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ReadResourceParams `json:"'resources/read',required" validate:"required"`
	'resources/subscribe' import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").SubscribeResourceParams `json:"'resources/subscribe',required" validate:"required"`
	'resources/unsubscribe' import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").UnsubscribeResourceParams `json:"'resources/unsubscribe',required" validate:"required"`
	'prompts/list' import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").PaginationParams `json:"'prompts/list',required" validate:"required"`
	'prompts/get' import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").GetPromptParams `json:"'prompts/get',required" validate:"required"`
	'completion/complete' import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").CompleteParams `json:"'completion/complete',required" validate:"required"`
	'logging/setLevel' import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").SetLogLevelParams `json:"'logging/setLevel',required" validate:"required"`
	'roots/list' Record<string, never> `json:"'roots/list',required" validate:"required"`
	'sampling/createMessage' import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").CreateMessageParams `json:"'sampling/createMessage',required" validate:"required"`
}

func (m *MCPRequestParams) Validate() error {
	return validate.Struct(m)
}

// 
Response Result Types by Method
type MCPResponseResults struct {
	initialize import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").InitializeResult `json:"initialize,required" validate:"required"`
	'tools/list' interface{} `json:"'tools/list',required" validate:"required"`
	'tools/call' import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").CallToolResult `json:"'tools/call',required" validate:"required"`
	'resources/list' interface{} `json:"'resources/list',required" validate:"required"`
	'resources/templates/list' interface{} `json:"'resources/templates/list',required" validate:"required"`
	'resources/read' { contents: import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ResourceContents[]; } `json:"'resources/read',required" validate:"required"`
	'resources/subscribe' Record<string, never> `json:"'resources/subscribe',required" validate:"required"`
	'resources/unsubscribe' Record<string, never> `json:"'resources/unsubscribe',required" validate:"required"`
	'prompts/list' interface{} `json:"'prompts/list',required" validate:"required"`
	'prompts/get' import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").GetPromptResult `json:"'prompts/get',required" validate:"required"`
	'completion/complete' import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").CompleteResult `json:"'completion/complete',required" validate:"required"`
	'logging/setLevel' Record<string, never> `json:"'logging/setLevel',required" validate:"required"`
	'roots/list' import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ListRootsResult `json:"'roots/list',required" validate:"required"`
	'sampling/createMessage' import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").CreateMessageResult `json:"'sampling/createMessage',required" validate:"required"`
}

func (m *MCPResponseResults) Validate() error {
	return validate.Struct(m)
}

// 
Notification Parameter Types
type MCPNotificationParams struct {
	'notifications/tools/list_changed' Record<string, never> `json:"'notifications/tools/list_changed',required" validate:"required"`
	'notifications/resources/list_changed' Record<string, never> `json:"'notifications/resources/list_changed',required" validate:"required"`
	'notifications/resources/updated' import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").ResourceUpdatedNotification `json:"'notifications/resources/updated',required" validate:"required"`
	'notifications/prompts/list_changed' Record<string, never> `json:"'notifications/prompts/list_changed',required" validate:"required"`
	'notifications/roots/list_changed' import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").RootsListChangedNotification `json:"'notifications/roots/list_changed',required" validate:"required"`
	'notifications/message' import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").LogMessageNotification `json:"'notifications/message',required" validate:"required"`
	'notifications/log' import("/Users/bipin/Desktop/Projects/MCP/spec/protocol/mcp-core").LogMessageNotification `json:"'notifications/log',required" validate:"required"`
}

func (m *MCPNotificationParams) Validate() error {
	return validate.Struct(m)
}

// ============================================================================
// Utility Functions
// ============================================================================

var (
	ErrInvalidToolResult = errors.New("invalid tool result: missing content")
	ErrInvalidResourceContents = errors.New("invalid resource contents: missing uri or mimeType")
)

func ValidateToolResult(data map[string]interface{}) error {
	if _, ok := data["content"]; !ok {
		return ErrInvalidToolResult
	}
	return nil
}

func ValidateResourceContents(data map[string]interface{}) error {
	if _, ok := data["uri"]; !ok {
		return ErrInvalidResourceContents
	}
	if _, ok := data["mimeType"]; !ok {
		return ErrInvalidResourceContents
	}
	return nil
}

// GenerateJSONSchema generates a JSON schema for the given type
func GenerateJSONSchema(v interface{}) (JSONSchema, error) {
	reflector := gojsonschema.NewReflector()
	schema, err := reflector.Reflect(v)
	if err != nil {
		return nil, err
	}
	doc, err := json.Marshal(schema)
	if err != nil {
		return nil, err
	}
	var result JSONSchema
	if err := json.Unmarshal(doc, &result); err != nil {
		return nil, err
	}
	return result, nil
}

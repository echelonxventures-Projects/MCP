// Package server provides the MCP Server Framework for Go
package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/mcp/go-sdk/types"
	"github.com/mcp/go-sdk/transports"
)

// ============================================================================
// Type Definitions
// ============================================================================

// ToolDefinition defines an MCP tool
type ToolDefinition struct {
	Name        string
	Description string
	InputSchema types.JSONSchema
	OutputSchema types.JSONSchema
	Annotations *types.ToolAnnotations
	Handler     ToolHandler
}

// ToolHandler is the function signature for tool handlers
type ToolHandler func(ctx context.Context, args map[string]any, toolCtx *ToolContext) (types.CallToolResult, error)

// ToolContext provides context to tool handlers
type ToolContext struct {
	RequestID     any
	ClientInfo    types.ClientCapabilities
	ServerInfo    *ServerInfo
	CancelSignal  context.Context
}

// ResourceDefinition defines an MCP resource
type ResourceDefinition struct {
	URIPattern string
	Name       string
	Description string
	MimeType   string
	Annotations *types.ResourceAnnotations
	Handler    ResourceHandler
}

// ResourceHandler is the function signature for resource handlers
type ResourceHandler func(ctx context.Context, uri ParsedURI, resCtx *ResourceContext) (types.ReadResourceResult, error)

// ParsedURI represents a parsed URI with parameters
type ParsedURI struct {
	Href    string
	Pattern string
	Params  map[string]string
}

// ResourceContext provides context to resource handlers
type ResourceContext struct {
	RequestID  any
	ClientInfo types.ClientCapabilities
}

// PromptDefinition defines an MCP prompt
type PromptDefinition struct {
	Name        string
	Description string
	Arguments   []types.PromptArgument
	Handler     PromptHandler
}

// PromptHandler is the function signature for prompt handlers
type PromptHandler func(ctx context.Context, args map[string]any, promptCtx *PromptContext) (types.GetPromptResult, error)

// PromptContext provides context to prompt handlers
type PromptContext struct {
	RequestID  any
	ClientInfo types.ClientCapabilities
}

// ServerInfo contains server metadata
type ServerInfo struct {
	Name        string
	Version     string
	Capabilities types.ServerCapabilities
}

// ServerStartConfig configures server startup
type ServerStartConfig struct {
	Transport transports.Transport
}

// ServerMiddleware defines middleware for the server
type ServerMiddleware interface {
	OnRequest(ctx *RequestContext, next func()) error
	OnResponse(ctx *ResponseContext, next func()) error
	OnError(ctx *ErrorContext, err error, next func()) error
	OnConnect(ctx *ConnectionContext) error
	OnDisconnect(ctx *ConnectionContext, err error) error
}

// ConnectionContext represents a client connection
type ConnectionContext struct {
	ConnectionID string
	Transport    transports.Transport
	ClientCaps   *types.ClientCapabilities
	ServerCaps   types.ServerCapabilities
	Metadata     map[string]any
}

// RequestContext represents an incoming request
type RequestContext struct {
	RequestID       any
	Method          string
	Params          any
	ClientCaps      types.ClientCapabilities
	ServerCaps      types.ServerCapabilities
	Transport       transports.Transport
	StartTime       time.Time
	Message         types.MCPMessage
}

// ResponseContext represents an outgoing response
type ResponseContext struct {
	RequestContext
	Response types.MCPMessage
}

// ErrorContext represents an error during request handling
type ErrorContext struct {
	RequestContext
	Error error
}

// ============================================================================
// Server Implementation
// ============================================================================

// McpServer is the main server implementation
type McpServer struct {
	name         string
	version      string
	capabilities types.ServerCapabilities

	tools      map[string]ToolDefinition
	resources  map[string]ResourceDefinition
	prompts    map[string]PromptDefinition
	middlewares []ServerMiddleware

	transport transports.Transport
	connections map[string]*ConnectionContext
	connCounter uint64

	initialized     bool
	clientCaps      *types.ClientCapabilities
	messageLoopDone chan struct{}
	mu              sync.RWMutex
}

// NewMcpServer creates a new MCP server
func NewMcpServer(name, version string, capabilities types.ServerCapabilities) *McpServer {
	return &McpServer{
		name:         name,
		version:      version,
		capabilities: capabilities,
		tools:        make(map[string]ToolDefinition),
		resources:    make(map[string]ResourceDefinition),
		prompts:      make(map[string]PromptDefinition),
		connections:  make(map[string]*ConnectionContext),
		messageLoopDone: make(chan struct{}),
	}
}

// Tool registers a tool
func (s *McpServer) Tool(def ToolDefinition) *McpServer {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.tools[def.Name]; exists {
		panic(fmt.Sprintf("tool already registered: %s", def.Name))
	}
	s.tools[def.Name] = def
	return s
}

// Resource registers a resource
func (s *McpServer) Resource(def ResourceDefinition) *McpServer {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.resources[def.URIPattern]; exists {
		panic(fmt.Sprintf("resource already registered: %s", def.URIPattern))
	}
	s.resources[def.URIPattern] = def
	return s
}

// Prompt registers a prompt
func (s *McpServer) Prompt(def PromptDefinition) *McpServer {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.prompts[def.Name]; exists {
		panic(fmt.Sprintf("prompt already registered: %s", def.Name))
	}
	s.prompts[def.Name] = def
	return s
}

// Use adds middleware
func (s *McpServer) Use(middleware ServerMiddleware) *McpServer {
	s.middlewares = append(s.middlewares, middleware)
	return s
}

// Start starts the server
func (s *McpServer) Start(ctx context.Context, config ServerStartConfig) error {
	s.mu.Lock()
	if s.transport != nil {
		s.mu.Unlock()
		return errors.New("server already started")
	}
	s.transport = config.Transport
	s.mu.Unlock()

	s.transport.SetOnConnect(s.handleConnect)
	s.transport.SetOnDisconnect(s.handleDisconnect)
	s.transport.SetOnError(s.handleTransportError)

	if err := s.transport.Connect(ctx); err != nil {
		return err
	}

	go s.messageLoop(ctx)
	return nil
}

// Stop stops the server
func (s *McpServer) Stop(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.transport == nil {
		return nil
	}

	// Close all connections
	for id, conn := range s.connections {
		s.closeConnection(ctx, id, errors.New("server stopping"))
	}

	if err := s.transport.Disconnect(ctx); err != nil {
		return err
	}

	s.transport = nil
	s.initialized = false
	s.clientCaps = nil
	close(s.messageLoopDone)
	s.messageLoopDone = make(chan struct{})

	return nil
}

// messageLoop processes incoming messages
func (s *McpServer) messageLoop(ctx context.Context) {
	defer close(s.messageLoopDone)

	messages := s.transport.Receive()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-messages:
			if !ok {
				return
			}
			s.handleMessage(ctx, msg)
		}
	}
}

// handleMessage processes a single message
func (s *McpServer) handleMessage(ctx context.Context, msg types.MCPMessage) {
	reqCtx := &RequestContext{
		RequestID:  msg.ID,
		Method:     msg.Method,
		Params:     msg.Params,
		ClientCaps: s.getClientCaps(),
		ServerCaps: s.capabilities,
		Transport:  s.transport,
		StartTime:  time.Now(),
		Message:    msg,
	}

	// Run request middleware
	if err := s.runRequestMiddleware(reqCtx); err != nil {
		s.sendError(ctx, reqCtx, err)
		return
	}

	// Dispatch message
	response, err := s.dispatchMessage(ctx, msg)
	if err != nil {
		s.sendError(ctx, reqCtx, err)
		return
	}

	if response != nil {
		respCtx := &ResponseContext{
			RequestContext: *reqCtx,
			Response:       response,
		}
		if err := s.runResponseMiddleware(respCtx); err != nil {
			s.sendError(ctx, reqCtx, err)
			return
		}
		s.transport.Send(ctx, response)
	}
}

// dispatchMessage routes messages to handlers
func (s *McpServer) dispatchMessage(ctx context.Context, msg types.MCPMessage) (types.MCPMessage, error) {
	if msg.IsNotification() {
		s.handleNotification(msg)
		return nil, nil
	}

	if !msg.IsRequest() {
		return nil, types.NewMCPError(msg.ID, types.ErrorCodeInvalidRequest, "not a request")
	}

	switch msg.Method {
	case "initialize":
		return s.handleInitialize(ctx, msg)
	case "tools/list":
		return s.createResponse(msg.ID, s.handleListTools())
	case "tools/call":
		return s.createResponse(msg.ID, s.handleCallTool(ctx, msg))
	case "resources/list":
		return s.createResponse(msg.ID, s.handleListResources(msg))
	case "resources/read":
		return s.createResponse(msg.ID, s.handleReadResource(ctx, msg))
	case "resources/subscribe":
		return s.createResponse(msg.ID, map[string]bool{"subscribed": true})
	case "resources/unsubscribe":
		return s.createResponse(msg.ID, map[string]bool{"unsubscribed": true})
	case "prompts/list":
		return s.createResponse(msg.ID, s.handleListPrompts(msg))
	case "prompts/get":
		return s.createResponse(msg.ID, s.handleGetPrompt(ctx, msg))
	case "ping":
		return s.createResponse(msg.ID, map[string]any{})
	default:
		return nil, types.NewMCPError(msg.ID, types.ErrorCodeMethodNotFound, "method not found: "+msg.Method)
	}
}

// handleNotification handles notifications
func (s *McpServer) handleNotification(msg types.MCPMessage) {
	switch msg.Method {
	case "initialized":
		s.initialized = true
	case "cancelled":
		// Handle cancellation
	}
}

// handleInitialize handles the initialize request
func (s *McpServer) handleInitialize(ctx context.Context, msg types.MCPMessage) (types.MCPMessage, error) {
	var params struct {
		ProtocolVersion string                     `json:"protocolVersion"`
		Capabilities    types.ClientCapabilities   `json:"capabilities"`
		ClientInfo      struct{ Name, Version string } `json:"clientInfo"`
	}
	if msg.Params != nil {
		data, _ := json.Marshal(msg.Params)
		json.Unmarshal(data, &params)
	}

	s.clientCaps = &params.Capabilities
	s.initialized = true

	return s.createResponse(msg.ID, map[string]any{
		"protocolVersion": "1.0",
		"capabilities":    s.capabilities,
		"serverInfo": map[string]string{
			"name":    s.name,
			"version": s.version,
		},
	}), nil
}

// handleListTools returns available tools
func (s *McpServer) handleListTools() types.ListToolsResult {
	s.mu.RLock()
	defer s.mu.RUnlock()

	tools := make([]types.Tool, 0, len(s.tools))
	for _, t := range s.tools {
		tools = append(tools, types.Tool{
			Name:         t.Name,
			Description:  t.Description,
			InputSchema:  t.InputSchema,
			OutputSchema: t.OutputSchema,
			Annotations:  t.Annotations,
		})
	}
	return types.ListToolsResult{Tools: tools}
}

// handleCallTool invokes a tool
func (s *McpServer) handleCallTool(ctx context.Context, msg types.MCPMessage) (types.CallToolResult, error) {
	var params struct {
		Name      string         `json:"name"`
		Arguments map[string]any `json:"arguments"`
	}
	if msg.Params != nil {
		data, _ := json.Marshal(msg.Params)
		json.Unmarshal(data, &params)
	}

	s.mu.RLock()
	tool, ok := s.tools[params.Name]
	s.mu.RUnlock()

	if !ok {
		return types.CallToolResult{}, types.NewMCPError(msg.ID, types.ErrorCodeToolNotFound, "tool not found: "+params.Name)
	}

	toolCtx := &ToolContext{
		RequestID:    msg.ID,
		ClientInfo:   s.getClientCaps(),
		ServerInfo:   &ServerInfo{Name: s.name, Version: s.version, Capabilities: s.capabilities},
		CancelSignal: ctx,
	}

	result, err := tool.Handler(ctx, params.Arguments, toolCtx)
	if err != nil {
		return types.CallToolResult{
			Content: []types.ResourceContents{{Type: "text", Text: "Tool error: " + err.Error()}},
			IsError: true,
		}, nil
	}
	return result, nil
}

// handleListResources returns available resources
func (s *McpServer) handleListResources(msg types.MCPMessage) types.ListResourcesResult {
	s.mu.RLock()
	defer s.mu.RUnlock()

	resources := make([]types.Resource, 0, len(s.resources))
	for _, r := range s.resources {
		resources = append(resources, types.Resource{
			URI:         r.URIPattern,
			Name:        r.Name,
			Description: r.Description,
			MimeType:    r.MimeType,
			Annotations: r.Annotations,
		})
	}
	return types.ListResourcesResult{Resources: resources}
}

// handleReadResource reads a resource
func (s *McpServer) handleReadResource(ctx context.Context, msg types.MCPMessage) (types.ReadResourceResult, error) {
	var params struct {
		URI string `json:"uri"`
	}
	if msg.Params != nil {
		data, _ := json.Marshal(msg.Params)
		json.Unmarshal(data, &params)
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	for pattern, resource := range s.resources {
		if parsed := s.parseURI(pattern, params.URI); parsed != nil {
			resCtx := &ResourceContext{
				RequestID:  msg.ID,
				ClientInfo: s.getClientCaps(),
			}
			return resource.Handler(ctx, *parsed, resCtx)
		}
	}

	return types.ReadResourceResult{}, types.NewMCPError(msg.ID, types.ErrorCodeResourceNotFound, "resource not found: "+params.URI)
}

// handleListPrompts returns available prompts
func (s *McpServer) handleListPrompts(msg types.MCPMessage) types.ListPromptsResult {
	s.mu.RLock()
	defer s.mu.RUnlock()

	prompts := make([]types.Prompt, 0, len(s.prompts))
	for _, p := range s.prompts {
		prompts = append(prompts, types.Prompt{
			Name:        p.Name,
			Description: p.Description,
			Arguments:   p.Arguments,
		})
	}
	return types.ListPromptsResult{Prompts: prompts}
}

// handleGetPrompt gets a prompt
func (s *McpServer) handleGetPrompt(ctx context.Context, msg types.MCPMessage) (types.GetPromptResult, error) {
	var params struct {
		Name      string         `json:"name"`
		Arguments map[string]any `json:"arguments"`
	}
	if msg.Params != nil {
		data, _ := json.Marshal(msg.Params)
		json.Unmarshal(data, &params)
	}

	s.mu.RLock()
	prompt, ok := s.prompts[params.Name]
	s.mu.RUnlock()

	if !ok {
		return types.GetPromptResult{}, types.NewMCPError(msg.ID, types.ErrorCodePromptNotFound, "prompt not found: "+params.Name)
	}

	promptCtx := &PromptContext{
		RequestID:  msg.ID,
		ClientInfo: s.getClientCaps(),
	}

	return prompt.Handler(ctx, params.Arguments, promptCtx)
}

// parseURI matches a URI against a pattern
func (s *McpServer) parseURI(pattern, uri string) *ParsedURI {
	// Simple pattern matching - convert {param} to regex
	// In production, use a proper router
	return &ParsedURI{Href: uri, Pattern: pattern, Params: map[string]string{}}
}

// createResponse creates a JSON-RPC response
func (s *McpServer) createResponse(id any, result any) (types.MCPMessage, error) {
	return types.MCPMessage{
		JSONRPC: "2.0",
		ID:      id,
		Result:  result,
	}, nil
}

// sendError sends an error response
func (s *McpServer) sendError(ctx context.Context, reqCtx *RequestContext, err error) {
	var mcpErr *types.MCPError
	if errors.As(err, &mcpErr) {
		mcpErr.ID = reqCtx.RequestID
	} else {
		mcpErr = types.NewMCPError(reqCtx.RequestID, types.ErrorCodeInternalError, err.Error())
	}
	s.transport.Send(ctx, mcpErr.ToMessage())
}

// runRequestMiddleware runs request middleware chain
func (s *McpServer) runRequestMiddleware(ctx *RequestContext) error {
	for _, m := range s.middlewares {
		if m.OnRequest != nil {
			if err := m.OnRequest(ctx, func() {}); err != nil {
				return err
			}
		}
	}
	return nil
}

// runResponseMiddleware runs response middleware chain
func (s *McpServer) runResponseMiddleware(ctx *ResponseContext) error {
	for i := len(s.middlewares) - 1; i >= 0; i-- {
		if s.middlewares[i].OnResponse != nil {
			if err := s.middlewares[i].OnResponse(ctx, func() {}); err != nil {
				return err
			}
		}
	}
	return nil
}

// handleConnect handles new connections
func (s *McpServer) handleConnect() {
	s.mu.Lock()
	defer s.mu.Unlock()

	id := fmt.Sprintf("conn-%d", atomic.AddUint64(&s.connCounter, 1))
	conn := &ConnectionContext{
		ConnectionID: id,
		Transport:    s.transport,
		ClientCaps:   s.clientCaps,
		ServerCaps:   s.capabilities,
		Metadata:     make(map[string]any),
	}
	s.connections[id] = conn

	for _, m := range s.middlewares {
		if m.OnConnect != nil {
			m.OnConnect(conn)
		}
	}
}

// handleDisconnect handles disconnections
func (s *McpServer) handleDisconnect(err error) {
	s.mu.Lock()
	conns := make([]*ConnectionContext, 0, len(s.connections))
	for _, c := range s.connections {
		conns = append(conns, c)
	}
	s.connections = make(map[string]*ConnectionContext)
	s.mu.Unlock()

	for _, conn := range conns {
		for _, m := range s.middlewares {
			if m.OnDisconnect != nil {
				m.OnDisconnect(conn, err)
			}
		}
	}
}

// handleTransportError handles transport errors
func (s *McpServer) handleTransportError(err error) {
	// Log error
}

// closeConnection closes a specific connection
func (s *McpServer) closeConnection(ctx context.Context, id string, err error) {
	s.mu.Lock()
	conn := s.connections[id]
	delete(s.connections, id)
	s.mu.Unlock()

	if conn != nil {
		for _, m := range s.middlewares {
			if m.OnDisconnect != nil {
				m.OnDisconnect(conn, err)
			}
		}
	}
}

// getClientCaps returns client capabilities
func (s *McpServer) getClientCaps() types.ClientCapabilities {
	if s.clientCaps != nil {
		return *s.clientCaps
	}
	return types.ClientCapabilities{}
}

// GetTools returns registered tools
func (s *McpServer) GetTools() []ToolDefinition {
	s.mu.RLock()
	defer s.mu.RUnlock()
	tools := make([]ToolDefinition, 0, len(s.tools))
	for _, t := range s.tools {
		tools = append(tools, t)
	}
	return tools
}

// GetResources returns registered resources
func (s *McpServer) GetResources() []ResourceDefinition {
	s.mu.RLock()
	defer s.mu.RUnlock()
	resources := make([]ResourceDefinition, 0, len(s.resources))
	for _, r := range s.resources {
		resources = append(resources, r)
	}
	return resources
}

// GetPrompts returns registered prompts
func (s *McpServer) GetPrompts() []PromptDefinition {
	s.mu.RLock()
	defer s.mu.RUnlock()
	prompts := make([]PromptDefinition, 0, len(s.prompts))
	for _, p := range s.prompts {
		prompts = append(prompts, p)
	}
	return prompts
}

// GetServerInfo returns server info
func (s *McpServer) GetServerInfo() *ServerInfo {
	return &ServerInfo{
		Name:        s.name,
		Version:     s.version,
		Capabilities: s.capabilities,
	}
}

// IsInitialized returns whether server is initialized
func (s *McpServer) IsInitialized() bool {
	return s.initialized
}

// GetConnectionCount returns number of active connections
func (s *McpServer) GetConnectionCount() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.connections)
}
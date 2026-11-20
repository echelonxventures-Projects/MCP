// Package client provides the MCP Client Framework for Go
package client

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

// ConnectionConfig configures a connection to an MCP server
type ConnectionConfig struct {
	ServerID    string
	Transport   transports.Transport
	Capabilities *types.ClientCapabilities
	Timeout     time.Duration
	Retry       *RetryConfig
	Failover    *FailoverConfig
}

// RetryConfig configures retry behavior
type RetryConfig struct {
	MaxAttempts       int
	BaseDelay         time.Duration
	MaxDelay          time.Duration
	BackoffMultiplier float64
	RetryableErrors   []int
}

// FailoverConfig configures failover behavior
type FailoverConfig struct {
	Enabled              bool
	BackupServers        []string
	HealthCheckInterval  time.Duration
	FailoverTimeout      time.Duration
}

// PoolConfig configures connection pooling
type PoolConfig struct {
	MaxConnections     int
	MinConnections     int
	AcquireTimeout     time.Duration
	IdleTimeout        time.Duration
	HealthCheckInterval time.Duration
}

// ConnectionStatus represents connection state
type ConnectionStatus string

const (
	StatusConnecting   ConnectionStatus = "connecting"
	StatusConnected    ConnectionStatus = "connected"
	StatusDisconnected ConnectionStatus = "disconnected"
	StatusReconnecting ConnectionStatus = "reconnecting"
	StatusFailed       ConnectionStatus = "failed"
)

// McpContext carries request context
type McpContext struct {
	RequestID     string
	ParentReqID   string
	Metadata      map[string]any
	TraceID       string
	SpanID        string
	TenantID      string
	UserID        string
}

// Connection represents a managed connection to an MCP server
type Connection struct {
	ServerID     string
	Transport    transports.Transport
	Capabilities types.ServerCapabilities
	Status       ConnectionStatus
	ConnectedAt  time.Time
	LastActivity time.Time

	mu           sync.Mutex
	requestID    uint64
	pending      map[any]chan *types.MCPMessage
	closeHandlers []func(error)
	errorHandlers []func(error)
	retryConfig  *RetryConfig
	failoverConfig *FailoverConfig
	closed       bool
	healthCheckTicker *time.Ticker
}

// ConnectionPool manages a pool of connections
type ConnectionPool struct {
	serverID       string
	config         PoolConfig
	transportFactory func() (transports.Transport, error)
	retryConfig    *RetryConfig
	failoverConfig *FailoverConfig

	mu           sync.Mutex
	connections  []*Connection
	available    []*Connection
	acquiring    int
	healthCheckTicker *time.Ticker
	onAvailable  []func(*Connection)
}

// ConnectionManager manages multiple connection pools
type ConnectionManager struct {
	mu           sync.Mutex
	pools        map[string]*ConnectionPool
	configs      map[string]ConnectionConfig
	contexts     map[string]*McpContext
	contextCounter uint64
	currentContext *McpContext
}

// ============================================================================
// Default Configurations
// ============================================================================

var (
	DefaultRetryConfig = &RetryConfig{
		MaxAttempts:       3,
		BaseDelay:         time.Second,
		MaxDelay:          10 * time.Second,
		BackoffMultiplier: 2.0,
		RetryableErrors: []int{
			types.ErrorCodeInternalError,
			types.ErrorCodeServiceUnavailable,
			types.ErrorCodeTimeout,
		},
	}

	DefaultFailoverConfig = &FailoverConfig{
		Enabled:             false,
		BackupServers:       []string{},
		HealthCheckInterval: 30 * time.Second,
		FailoverTimeout:     5 * time.Second,
	}

	DefaultPoolConfig = PoolConfig{
		MaxConnections:      10,
		MinConnections:      0,
		AcquireTimeout:      5 * time.Second,
		IdleTimeout:         60 * time.Second,
		HealthCheckInterval: 30 * time.Second,
	}
)

// ============================================================================
// Connection Implementation
// ============================================================================

// NewConnection creates a new managed connection
func NewConnection(
	serverID string,
	transport transports.Transport,
	capabilities types.ServerCapabilities,
	retryConfig *RetryConfig,
	failoverConfig *FailoverConfig,
) *Connection {
	conn := &Connection{
		ServerID:       serverID,
		Transport:      transport,
		Capabilities:   capabilities,
		Status:         StatusConnecting,
		ConnectedAt:    time.Now(),
		LastActivity:   time.Now(),
		pending:        make(map[any]chan *types.MCPMessage),
		retryConfig:    retryConfig,
		failoverConfig: failoverConfig,
	}

	transport.SetOnConnect(conn.onConnect)
	transport.SetOnDisconnect(conn.onDisconnect)
	transport.SetOnError(conn.onError)

	return conn
}

func (c *Connection) onConnect() {
	c.mu.Lock()
	c.Status = StatusConnected
	c.mu.Unlock()
	c.startHealthCheck()
}

func (c *Connection) onDisconnect(err error) {
	c.mu.Lock()
	if err != nil {
		c.Status = StatusFailed
	} else {
		c.Status = StatusDisconnected
	}
	c.stopHealthCheck()
	c.rejectAllPending(err)
	handlers := c.closeHandlers
	c.mu.Unlock()

	for _, h := range handlers {
		h(err)
	}
}

func (c *Connection) onError(err error) {
	c.mu.Lock()
	handlers := c.errorHandlers
	c.mu.Unlock()
	for _, h := range handlers {
		h(err)
	}
}

func (c *Connection) startHealthCheck() {
	if c.failoverConfig.Enabled && c.failoverConfig.HealthCheckInterval > 0 {
		c.healthCheckTicker = time.NewTicker(c.failoverConfig.HealthCheckInterval)
		go func() {
			for range c.healthCheckTicker.C {
				if c.closed {
					return
				}
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				c.ping(ctx)
				cancel()
			}
		}()
	}
}

func (c *Connection) stopHealthCheck() {
	if c.healthCheckTicker != nil {
		c.healthCheckTicker.Stop()
		c.healthCheckTicker = nil
	}
}

// Connect establishes the connection
func (c *Connection) Connect(ctx context.Context) error {
	return c.Transport.Connect(ctx)
}

// Disconnect closes the connection
func (c *Connection) Disconnect(ctx context.Context) error {
	c.closed = true
	c.stopHealthCheck()
	return c.Transport.Disconnect(ctx)
}

// Request sends a request and waits for response
func (c *Connection) Request(ctx context.Context, method string, params any) (any, error) {
	c.mu.Lock()
	if c.Status != StatusConnected {
		c.mu.Unlock()
		return nil, fmt.Errorf("connection not ready: %s", c.Status)
	}
	requestID := atomic.AddUint64(&c.requestID, 1)
	c.mu.Unlock()

	msg := types.MCPMessage{
		JSONRPC: "2.0",
		ID:      requestID,
		Method:  method,
		Params:  params,
	}

	responseChan := make(chan *types.MCPMessage, 1)
	c.mu.Lock()
	c.pending[requestID] = responseChan
	c.mu.Unlock()

	timeout := time.After(c.retryConfig.MaxDelay)
	if err := c.Transport.Send(ctx, msg); err != nil {
		c.mu.Lock()
		delete(c.pending, requestID)
		c.mu.Unlock()
		return nil, err
	}

	select {
	case resp := <-responseChan:
		if resp.Error != nil {
			return nil, resp.Error
		}
		return resp.Result, nil
	case <-timeout:
		c.mu.Lock()
		delete(c.pending, requestID)
		c.mu.Unlock()
		return nil, fmt.Errorf("request timeout: %s", method)
	case <-ctx.Done():
		c.mu.Lock()
		delete(c.pending, requestID)
		c.mu.Unlock()
		return nil, ctx.Err()
	}
}

// Notify sends a notification (no response expected)
func (c *Connection) Notify(ctx context.Context, method string, params any) error {
	c.mu.Lock()
	if c.Status != StatusConnected {
		c.mu.Unlock()
		return fmt.Errorf("connection not ready: %s", c.Status)
	}
	c.mu.Unlock()

	msg := types.MCPMessage{
		JSONRPC: "2.0",
		Method:  method,
		Params:  params,
	}
	return c.Transport.Send(ctx, msg)
}

// Close closes the connection
func (c *Connection) Close(ctx context.Context) error {
	return c.Disconnect(ctx)
}

// OnClose registers a close handler
func (c *Connection) OnClose(handler func(error)) {
	c.mu.Lock()
	c.closeHandlers = append(c.closeHandlers, handler)
	c.mu.Unlock()
}

// OnError registers an error handler
func (c *Connection) OnError(handler func(error)) {
	c.mu.Lock()
	c.errorHandlers = append(c.errorHandlers, handler)
	c.mu.Unlock()
}

func (c *Connection) rejectAllPending(err error) {
	for _, ch := range c.pending {
		select {
		case ch <- &types.MCPMessage{Error: types.NewMCPError(0, types.ErrorCodeInternalError, err.Error())}:
		default:
		}
	}
	c.pending = make(map[any]chan *types.MCPMessage)
}

func (c *Connection) handleResponse(msg *types.MCPMessage) {
	c.mu.Lock()
	ch := c.pending[msg.ID]
	delete(c.pending, msg.ID)
	c.mu.Unlock()

	if ch != nil {
		select {
		case ch <- msg:
		default:
		}
	}
}

func (c *Connection) ping(ctx context.Context) error {
	_, err := c.Request(ctx, "ping", nil)
	return err
}

// ============================================================================
// Connection Pool Implementation
// ============================================================================

// NewConnectionPool creates a new connection pool
func NewConnectionPool(
	serverID string,
	config PoolConfig,
	transportFactory func() (transports.Transport, error),
	retryConfig *RetryConfig,
	failoverConfig *FailoverConfig,
) *ConnectionPool {
	return &ConnectionPool{
		serverID:        serverID,
		config:          config,
		transportFactory: transportFactory,
		retryConfig:     retryConfig,
		failoverConfig:  failoverConfig,
		onAvailable:     make([]func(*Connection), 0),
	}
}

// Acquire gets a connection from the pool
func (p *ConnectionPool) Acquire(ctx context.Context) (*Connection, error) {
	p.mu.Lock()
	// Try available connections first
	for len(p.available) > 0 {
		conn := p.available[0]
		p.available = p.available[1:]
		p.mu.Unlock()

		if conn.Status == StatusConnected {
			return conn, nil
		}
		// Stale connection, destroy it
		p.destroyConnection(ctx, conn)
		p.mu.Lock()
	}
	p.mu.Unlock()

	// Check pool limit
	if len(p.connections) >= p.config.MaxConnections {
		// Wait for available connection
		ch := make(chan *Connection, 1)
		p.mu.Lock()
		p.onAvailable = append(p.onAvailable, func(c *Connection) {
			select {
			case ch <- c:
			default:
			}
		})
		p.mu.Unlock()

		select {
		case conn := <-ch:
			return conn, nil
		case <-time.After(p.config.AcquireTimeout):
			p.mu.Lock()
			// Remove our callback
			for i, cb := range p.onAvailable {
				// Can't easily remove, just let it fire
				_ = cb
				_ = i
			}
			p.mu.Unlock()
			return nil, fmt.Errorf("pool exhausted for %s", p.serverID)
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}

	// Create new connection
	p.mu.Lock()
	p.acquiring++
	p.mu.Unlock()

	transport, err := p.transportFactory()
	if err != nil {
		p.mu.Lock()
		p.acquiring--
		p.mu.Unlock()
		return nil, err
	}

	conn, err := p.createConnection(ctx, transport)
	p.mu.Lock()
	p.acquiring--
	p.connections = append(p.connections, conn)
	p.mu.Unlock()

	return conn, err
}

// Release returns a connection to the pool
func (p *ConnectionPool) Release(conn *Connection) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if conn.Status == StatusConnected && !conn.closed {
		p.available = append(p.available, conn)
		for _, cb := range p.onAvailable {
			cb(conn)
		}
	} else {
		go p.destroyConnection(context.Background(), conn)
	}
}

func (p *ConnectionPool) createConnection(ctx context.Context, transport transports.Transport) (*Connection, error) {
	conn := NewConnection(
		p.serverID,
		transport,
		types.ServerCapabilities{},
		p.retryConfig,
		p.failoverConfig,
	)

	if err := conn.Connect(ctx); err != nil {
		return nil, err
	}

	// Initialize
	initResult, err := conn.Request(ctx, "initialize", map[string]any{
		"protocolVersion": "1.0",
		"capabilities":    map[string]any{},
		"clientInfo": map[string]string{
			"name":    "mcp-client",
			"version": "0.1.0",
		},
	})
	if err != nil {
		conn.Disconnect(ctx)
		return nil, err
	}

	if caps, ok := initResult.(map[string]any); ok {
		if c, ok := caps["capabilities"].(types.ServerCapabilities); ok {
			conn.Capabilities = c
		}
	}

	conn.Notify(ctx, "initialized", map[string]any{})

	conn.OnClose(func(_ error) {
		p.removeConnection(conn)
	})

	return conn, nil
}

func (p *ConnectionPool) destroyConnection(ctx context.Context, conn *Connection) {
	p.mu.Lock()
	// Remove from connections
	for i, c := range p.connections {
		if c == conn {
			p.connections = append(p.connections[:i], p.connections[i+1:]...)
			break
		}
	}
	// Remove from available
	for i, c := range p.available {
		if c == conn {
			p.available = append(p.available[:i], p.available[i+1:]...)
			break
		}
	}
	p.mu.Unlock()

	conn.Disconnect(ctx)
}

func (p *ConnectionPool) removeConnection(conn *Connection) {
	p.destroyConnection(context.Background(), conn)
}

// Initialize pre-warms the pool
func (p *ConnectionPool) Initialize(ctx context.Context) error {
	for i := 0; i < p.config.MinConnections; i++ {
		transport, err := p.transportFactory()
		if err != nil {
			continue
		}
		conn, err := p.createConnection(ctx, transport)
		if err != nil {
			continue
		}
		p.mu.Lock()
		p.connections = append(p.connections, conn)
		p.available = append(p.available, conn)
		p.mu.Unlock()
	}

	p.healthCheckTicker = time.NewTicker(p.config.HealthCheckInterval)
	go func() {
		for range p.healthCheckTicker.C {
			p.healthCheck()
		}
	}()

	return nil
}

func (p *ConnectionPool) healthCheck() {
	p.mu.Lock()
	available := make([]*Connection, len(p.available))
	copy(available, p.available)
	p.mu.Unlock()

	now := time.Now()
	for _, conn := range available {
		conn.mu.Lock()
		idle := now.Sub(conn.LastActivity)
		conn.mu.Unlock()

		if idle > p.config.IdleTimeout {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			if err := conn.ping(ctx); err != nil {
				p.destroyConnection(ctx, conn)
			}
			cancel()
		}
	}
}

// Shutdown closes all connections
func (p *ConnectionPool) Shutdown(ctx context.Context) error {
	if p.healthCheckTicker != nil {
		p.healthCheckTicker.Stop()
	}

	p.mu.Lock()
	connections := make([]*Connection, len(p.connections))
	copy(connections, p.connections)
	p.connections = nil
	p.available = nil
	p.mu.Unlock()

	for _, conn := range connections {
		conn.Disconnect(ctx)
	}
	return nil
}

// GetStats returns pool statistics
func (p *ConnectionPool) GetStats() map[string]int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return map[string]int{
		"total":     len(p.connections),
		"available": len(p.available),
		"acquiring": p.acquiring,
	}
}

// ============================================================================
// Connection Manager Implementation
// ============================================================================

// NewConnectionManager creates a new connection manager
func NewConnectionManager() *ConnectionManager {
	return &ConnectionManager{
		pools:    make(map[string]*ConnectionPool),
		configs:  make(map[string]ConnectionConfig),
		contexts: make(map[string]*McpContext),
	}
}

// Connect creates or gets a connection pool and acquires a connection
func (m *ConnectionManager) Connect(ctx context.Context, config ConnectionConfig) (*Connection, error) {
	m.mu.Lock()
	m.configs[config.ServerID] = config
	pool := m.pools[config.ServerID]
	m.mu.Unlock()

	if pool == nil {
		poolConfig := DefaultPoolConfig
		retryConfig := DefaultRetryConfig
		if config.Retry != nil {
			retryConfig = config.Retry
		}
		failoverConfig := DefaultFailoverConfig
		if config.Failover != nil {
			failoverConfig = config.Failover
		}

		transportFactory := func() (transports.Transport, error) {
			return config.Transport, nil
		}

		pool = NewConnectionPool(config.ServerID, poolConfig, transportFactory, retryConfig, failoverConfig)
		if err := pool.Initialize(ctx); err != nil {
			return nil, err
		}

		m.mu.Lock()
		m.pools[config.ServerID] = pool
		m.mu.Unlock()
	}

	return pool.Acquire(ctx)
}

// GetConnection returns an existing connection if available
func (m *ConnectionManager) GetConnection(serverID string) *Connection {
	m.mu.Lock()
	pool := m.pools[serverID]
	m.mu.Unlock()

	if pool == nil {
		return nil
	}
	// This would need pool API to get actual connection
	return nil
}

// GetOrCreateConnection gets or creates a connection
func (m *ConnectionManager) GetOrCreateConnection(ctx context.Context, serverID string) (*Connection, error) {
	m.mu.Lock()
	config := m.configs[serverID]
	m.mu.Unlock()

	if config.ServerID == "" {
		return nil, fmt.Errorf("no configuration for server: %s", serverID)
	}
	return m.Connect(ctx, config)
}

// CreateContext creates a new context
func (m *ConnectionManager) CreateContext(parent *McpContext) *McpContext {
	atomic.AddUint64(&m.contextCounter, 1)
	ctx := &McpContext{
		RequestID:    fmt.Sprintf("ctx-%d", m.contextCounter),
		Metadata:     make(map[string]any),
	}
	if parent != nil {
		ctx.ParentReqID = parent.RequestID
		for k, v := range parent.Metadata {
			ctx.Metadata[k] = v
		}
		ctx.TraceID = parent.TraceID
		ctx.SpanID = parent.SpanID
		ctx.TenantID = parent.TenantID
		ctx.UserID = parent.UserID
	}
	m.mu.Lock()
	m.contexts[ctx.RequestID] = ctx
	m.mu.Unlock()
	return ctx
}

// GetContext retrieves a context
func (m *ConnectionManager) GetContext(contextID string) *McpContext {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.contexts[contextID]
}

// DeleteContext removes a context
func (m *ConnectionManager) DeleteContext(contextID string) {
	m.mu.Lock()
	delete(m.contexts, contextID)
	m.mu.Unlock()
}

// RunWithContext executes a function with a context
func (m *ConnectionManager) RunWithContext(ctx context.Context, mcpCtx *McpContext, fn func(context.Context) (any, error)) (any, error) {
	m.mu.Lock()
	prev := m.currentContext
	m.currentContext = mcpCtx
	m.mu.Unlock()

	defer func() {
		m.mu.Lock()
		m.currentContext = prev
		m.mu.Unlock()
	}()

	return fn(ctx)
}

// InvokeTool calls a tool on a server
func (m *ConnectionManager) InvokeTool(ctx context.Context, serverID, tool string, args map[string]any) (types.CallToolResult, error) {
	conn, err := m.GetOrCreateConnection(ctx, serverID)
	if err != nil {
		return types.CallToolResult{}, err
	}
	result, err := conn.Request(ctx, "tools/call", map[string]any{
		"name":      tool,
		"arguments": args,
	})
	if err != nil {
		return types.CallToolResult{}, err
	}
	return result.(types.CallToolResult), nil
}

// ReadResource reads a resource
func (m *ConnectionManager) ReadResource(ctx context.Context, serverID, uri string) (types.ReadResourceResult, error) {
	conn, err := m.GetOrCreateConnection(ctx, serverID)
	if err != nil {
		return types.ReadResourceResult{}, err
	}
	result, err := conn.Request(ctx, "resources/read", map[string]string{"uri": uri})
	if err != nil {
		return types.ReadResourceResult{}, err
	}
	return result.(types.ReadResourceResult), nil
}

// RenderPrompt renders a prompt
func (m *ConnectionManager) RenderPrompt(ctx context.Context, serverID, name string, args map[string]any) (types.GetPromptResult, error) {
	conn, err := m.GetOrCreateConnection(ctx, serverID)
	if err != nil {
		return types.GetPromptResult{}, err
	}
	result, err := conn.Request(ctx, "prompts/get", map[string]any{
		"name":      name,
		"arguments": args,
	})
	if err != nil {
		return types.GetPromptResult{}, err
	}
	return result.(types.GetPromptResult), nil
}

// ListTools lists available tools
func (m *ConnectionManager) ListTools(ctx context.Context, serverID string) ([]types.Tool, error) {
	conn, err := m.GetOrCreateConnection(ctx, serverID)
	if err != nil {
		return nil, err
	}
	result, err := conn.Request(ctx, "tools/list", nil)
	if err != nil {
		return nil, err
	}
	return result.(types.ListToolsResult).Tools, nil
}

// ListResources lists available resources
func (m *ConnectionManager) ListResources(ctx context.Context, serverID string) ([]types.Resource, error) {
	conn, err := m.GetOrCreateConnection(ctx, serverID)
	if err != nil {
		return nil, err
	}
	result, err := conn.Request(ctx, "resources/list", nil)
	if err != nil {
		return nil, err
	}
	return result.(types.ListResourcesResult).Resources, nil
}

// ListPrompts lists available prompts
func (m *ConnectionManager) ListPrompts(ctx context.Context, serverID string) ([]types.Prompt, error) {
	conn, err := m.GetOrCreateConnection(ctx, serverID)
	if err != nil {
		return nil, err
	}
	result, err := conn.Request(ctx, "prompts/list", nil)
	if err != nil {
		return nil, err
	}
	return result.(types.ListPromptsResult).Prompts, nil
}

// Shutdown closes all pools
func (m *ConnectionManager) Shutdown(ctx context.Context) error {
	m.mu.Lock()
	pools := make([]*ConnectionPool, 0, len(m.pools))
	for _, p := range m.pools {
		pools = append(pools, p)
	}
	m.pools = nil
	m.configs = nil
	m.contexts = nil
	m.mu.Unlock()

	for _, pool := range pools {
		pool.Shutdown(ctx)
	}
	return nil
}

// ============================================================================
// MCP Client Facade
// ============================================================================

// McpClient provides a high-level client interface
type McpClient struct {
	ServerID     string
	Capabilities types.ServerCapabilities
	conn         *Connection
	manager      *ConnectionManager
}

// NewMcpClient creates a new MCP client
func NewMcpClient(conn *Connection, manager *ConnectionManager, serverID string) *McpClient {
	return &McpClient{
		ServerID:     serverID,
		Capabilities: conn.Capabilities,
		conn:         conn,
		manager:      manager,
	}
}

func (c *McpClient) ListTools(ctx context.Context) ([]types.Tool, error) {
	return c.manager.ListTools(ctx, c.ServerID)
}

func (c *McpClient) CallTool(ctx context.Context, name string, args map[string]any) (types.CallToolResult, error) {
	return c.manager.InvokeTool(ctx, c.ServerID, name, args)
}

func (c *McpClient) ListResources(ctx context.Context) ([]types.Resource, error) {
	return c.manager.ListResources(ctx, c.ServerID)
}

func (c *McpClient) ReadResource(ctx context.Context, uri string) (types.ReadResourceResult, error) {
	return c.manager.ReadResource(ctx, c.ServerID, uri)
}

func (c *McpClient) ListPrompts(ctx context.Context) ([]types.Prompt, error) {
	return c.manager.ListPrompts(ctx, c.ServerID)
}

func (c *McpClient) GetPrompt(ctx context.Context, name string, args map[string]any) (types.GetPromptResult, error) {
	return c.manager.RenderPrompt(ctx, c.ServerID, name, args)
}

func (c *McpClient) Close(ctx context.Context) error {
	return c.conn.Close(ctx)
}

// ConnectToServer connects to a server and returns a client
func ConnectToServer(ctx context.Context, manager *ConnectionManager, config ConnectionConfig) (*McpClient, error) {
	conn, err := manager.Connect(ctx, config)
	if err != nil {
		return nil, err
	}
	return NewMcpClient(conn, manager, config.ServerID), nil
}
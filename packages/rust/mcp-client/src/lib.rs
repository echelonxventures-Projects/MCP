//! mcp-client - MCP Client Framework for Rust

use std::collections::HashMap;
use std::sync::{Arc, RwLock, atomic::{AtomicU64, Ordering}};
use std::time::{Duration, Instant};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use schemars::JsonSchema;
use thiserror::Error;
use tokio::sync::{mpsc, oneshot};
use futures::StreamExt;
use uuid::Uuid;

use mcp_types::*;
use mcp_transports::{Transport, TransportConfig, TransportType, create_transport};

// ============================================================================
// Type Definitions
// ============================================================================

/// Connection configuration
#[derive(Debug, Clone)]
pub struct ConnectionConfig {
    pub server_id: String,
    pub transport: TransportType,
    pub port: Option<u16>,
    pub host: Option<String>,
    pub capabilities: Option<ClientCapabilities>,
    pub timeout: Duration,
    pub retry: Option<RetryConfig>,
    pub failover: Option<FailoverConfig>,
}

/// Retry configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetryConfig {
    pub max_attempts: u32,
    pub base_delay: Duration,
    pub max_delay: Duration,
    pub backoff_multiplier: f64,
    pub retryable_errors: Vec<i32>,
}

impl Default for RetryConfig {
    fn default() -> Self {
        Self {
            max_attempts: 3,
            base_delay: Duration::from_secs(1),
            max_delay: Duration::from_secs(10),
            backoff_multiplier: 2.0,
            retryable_errors: vec![
                ErrorCode::InternalError as i32,
                ErrorCode::ServiceUnavailable as i32,
                ErrorCode::Timeout as i32,
            ],
        }
    }
}

/// Failover configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FailoverConfig {
    pub enabled: bool,
    pub backup_servers: Vec<String>,
    pub health_check_interval: Duration,
    pub failover_timeout: Duration,
}

impl Default for FailoverConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            backup_servers: Vec::new(),
            health_check_interval: Duration::from_secs(30),
            failover_timeout: Duration::from_secs(5),
        }
    }
}

/// Pool configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PoolConfig {
    pub max_connections: usize,
    pub min_connections: usize,
    pub acquire_timeout: Duration,
    pub idle_timeout: Duration,
    pub health_check_interval: Duration,
}

impl Default for PoolConfig {
    fn default() -> Self {
        Self {
            max_connections: 10,
            min_connections: 0,
            acquire_timeout: Duration::from_secs(5),
            idle_timeout: Duration::from_secs(60),
            health_check_interval: Duration::from_secs(30),
        }
    }
}

/// Connection status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConnectionStatus {
    Connecting,
    Connected,
    Disconnected,
    Reconnecting,
    Failed,
}

/// MCP context for request tracing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpContext {
    pub request_id: String,
    pub parent_request_id: Option<String>,
    pub metadata: HashMap<String, serde_json::Value>,
    pub trace_id: Option<String>,
    pub span_id: Option<String>,
    pub tenant_id: Option<String>,
    pub user_id: Option<String>,
}

/// Connection errors
#[derive(Debug, Error)]
pub enum ConnectionError {
    #[error("connection not ready: {0:?}")]
    NotReady(ConnectionStatus),
    #[error("request timeout: {0}")]
    Timeout(String),
    #[error("transport error: {0}")]
    Transport(#[from] mcp_transports::TransportError),
    #[error("protocol error: {0}")]
    Protocol(String),
    #[error("pool exhausted: {0}")]
    PoolExhausted(String),
    #[error("server not configured: {0}")]
    NotConfigured(String),
    #[error("internal error: {0}")]
    Internal(String),
}

// ============================================================================
// Connection Implementation
// ============================================================================

/// Managed connection to an MCP server
pub struct Connection {
    server_id: String,
    transport: Arc<dyn Transport>,
    capabilities: RwLock<ServerCapabilities>,
    status: RwLock<ConnectionStatus>,
    connected_at: Instant,
    last_activity: RwLock<Instant>,

    request_counter: AtomicU64,
    pending: RwLock<HashMap<RequestId, oneshot::Sender<MCPMessage>>>,
    close_handlers: RwLock<Vec<Box<dyn Fn(Option<ConnectionError>) + Send + Sync>>>,
    error_handlers: RwLock<Vec<Box<dyn Fn(ConnectionError) + Send + Sync>>>,
    retry_config: RetryConfig,
    failover_config: FailoverConfig,
    closed: RwLock<bool>,
}

impl Connection {
    /// Create a new managed connection
    pub async fn new(
        server_id: String,
        transport: Arc<dyn Transport>,
        capabilities: ServerCapabilities,
        retry_config: RetryConfig,
        failover_config: FailoverConfig,
    ) -> Result<Arc<Self>, ConnectionError> {
        let conn = Arc::new(Self {
            server_id,
            transport: transport.clone(),
            capabilities: RwLock::new(capabilities),
            status: RwLock::new(ConnectionStatus::Connecting),
            connected_at: Instant::now(),
            last_activity: RwLock::new(Instant::now()),
            request_counter: AtomicU64::new(0),
            pending: RwLock::new(HashMap::new()),
            close_handlers: RwLock::new(Vec::new()),
            error_handlers: RwLock::new(Vec::new()),
            retry_config,
            failover_config,
            closed: RwLock::new(false),
        });

        // Set up transport event handlers
        let conn_clone = conn.clone();
        transport.set_on_connect(Box::new(move || {
            let conn = conn_clone.clone();
            Box::pin(async move { conn.on_connect().await })
        }));

        let conn_clone = conn.clone();
        transport.set_on_disconnect(Box::new(move |err| {
            let conn = conn_clone.clone();
            Box::pin(async move { conn.on_disconnect(err).await })
        }));

        let conn_clone = conn.clone();
        transport.set_on_error(Box::new(move |err| {
            let conn = conn_clone.clone();
            Box::pin(async move { conn.on_error(err).await })
        }));

        // Connect transport
        transport.connect().await?;

        Ok(conn)
    }

    async fn on_connect(&self) {
        *self.status.write().unwrap() = ConnectionStatus::Connected;
        self.start_health_check().await;
    }

    async fn on_disconnect(&self, error: Option<mcp_transports::TransportError>) {
        let mut status = self.status.write().unwrap();
        *status = error.map(|_| ConnectionStatus::Failed).unwrap_or(ConnectionStatus::Disconnected);
        drop(status);

        self.stop_health_check().await;
        self.reject_all_pending(ConnectionError::Internal("connection closed".into())).await;

        let handlers = self.close_handlers.read().unwrap().clone();
        for handler in handlers {
            handler(error.map(ConnectionError::Transport));
        }
    }

    async fn on_error(&self, error: mcp_transports::TransportError) {
        let handlers = self.error_handlers.read().unwrap().clone();
        for handler in handlers {
            handler(ConnectionError::Transport(error.clone()));
        }
    }

    async fn start_health_check(&self) {
        if self.failover_config.enabled && self.failover_config.health_check_interval > Duration::ZERO {
            let conn = self.clone();
            let interval = self.failover_config.health_check_interval;
            tokio::spawn(async move {
                let mut interval_timer = tokio::time::interval(interval);
                loop {
                    interval_timer.tick().await;
                    if *conn.closed.read().unwrap() {
                        break;
                    }
                    let _ = conn.ping().await;
                }
            });
        }
    }

    async fn stop_health_check(&self) {
        // Health check stops when closed flag is set
    }

    /// Get server ID
    pub fn server_id(&self) -> &str {
        &self.server_id
    }

    /// Get capabilities
    pub fn capabilities(&self) -> ServerCapabilities {
        self.capabilities.read().unwrap().clone()
    }

    /// Get connection status
    pub fn status(&self) -> ConnectionStatus {
        *self.status.read().unwrap()
    }

    /// Send a request and wait for response
    pub async fn request(&self, method: &str, params: Option<serde_json::Value>) -> Result<serde_json::Value, ConnectionError> {
        let status = *self.status.read().unwrap();
        if status != ConnectionStatus::Connected {
            return Err(ConnectionError::NotReady(status));
        }

        let request_id = RequestId::new(format!("req-{}", self.request_counter.fetch_add(1, Ordering::SeqCst)));
        let (tx, rx) = oneshot::channel();

        {
            let mut pending = self.pending.write().unwrap();
            pending.insert(request_id.clone(), tx);
        }

        let message = MCPMessage {
            jsonrpc: "2.0".into(),
            id: Some(request_id.clone()),
            method: Some(method.into()),
            params,
            result: None,
            error: None,
        };

        self.transport.send(message).await?;

        // Wait for response with timeout
        let timeout = self.retry_config.max_delay;
        let result = tokio::time::timeout(timeout, rx).await;

        // Clean up pending
        self.pending.write().unwrap().remove(&request_id);

        match result {
            Ok(Ok(response)) => {
                if let Some(error) = response.error {
                    return Err(ConnectionError::Protocol(format!("MCP error {}: {}", error.code, error.message)));
                }
                Ok(response.result.unwrap_or(serde_json::Value::Null))
            }
            Ok(Err(_)) => Err(ConnectionError::Internal("response channel closed".into())),
            Err(_) => Err(ConnectionError::Timeout(method.into())),
        }
    }

    /// Send a notification (no response expected)
    pub async fn notify(&self, method: &str, params: Option<serde_json::Value>) -> Result<(), ConnectionError> {
        let status = *self.status.read().unwrap();
        if status != ConnectionStatus::Connected {
            return Err(ConnectionError::NotReady(status));
        }

        let message = MCPMessage {
            jsonrpc: "2.0".into(),
            id: None,
            method: Some(method.into()),
            params,
            result: None,
            error: None,
        };

        self.transport.send(message).await?;
        Ok(())
    }

    /// Close the connection
    pub async fn close(&self) -> Result<(), ConnectionError> {
        *self.closed.write().unwrap() = true;
        self.stop_health_check().await;
        self.transport.disconnect().await?;
        Ok(())
    }

    /// Register a close handler
    pub fn on_close(&self, handler: impl Fn(Option<ConnectionError>) + Send + Sync + 'static) {
        self.close_handlers.write().unwrap().push(Box::new(handler));
    }

    /// Register an error handler
    pub fn on_error(&self, handler: impl Fn(ConnectionError) + Send + Sync + 'static) {
        self.error_handlers.write().unwrap().push(Box::new(handler));
    }

    async fn reject_all_pending(&self, error: ConnectionError) {
        let mut pending = self.pending.write().unwrap();
        for (_, tx) in pending.drain() {
            let _ = tx.send(MCPMessage {
                jsonrpc: "2.0".into(),
                id: None,
                method: None,
                params: None,
                result: None,
                error: Some(MCPError {
                    code: ErrorCode::InternalError as i32,
                    message: error.to_string(),
                    data: None,
                }),
            });
        }
    }

    fn handle_response(&self, response: MCPMessage) {
        if let Some(id) = &response.id {
            let mut pending = self.pending.write().unwrap();
            if let Some(tx) = pending.remove(id) {
                let _ = tx.send(response);
            }
        }
    }

    async fn ping(&self) -> Result<(), ConnectionError> {
        self.request("ping", None).await?;
        Ok(())
    }
}

// Need Clone for health check
impl Clone for Connection {
    fn clone(&self) -> Self {
        // This is a simplified clone - in reality we'd use Arc<Connection>
        unimplemented!("Use Arc<Connection> instead")
    }
}

// ============================================================================
// Connection Pool Implementation
// ============================================================================

/// Connection pool for a single server
pub struct ConnectionPool {
    server_id: String,
    config: PoolConfig,
    transport_factory: Box<dyn Fn() -> Result<Arc<dyn Transport>, mcp_transports::TransportError> + Send + Sync>,
    retry_config: RetryConfig,
    failover_config: FailoverConfig,

    connections: RwLock<Vec<Arc<Connection>>>,
    available: RwLock<Vec<Arc<Connection>>>,
    acquiring: RwLock<usize>,
    on_available: RwLock<Vec<Box<dyn Fn(Arc<Connection>) + Send + Sync>>>,
}

impl ConnectionPool {
    /// Create a new connection pool
    pub fn new<F>(
        server_id: String,
        config: PoolConfig,
        transport_factory: F,
        retry_config: RetryConfig,
        failover_config: FailoverConfig,
    ) -> Self
    where
        F: Fn() -> Result<Arc<dyn Transport>, mcp_transports::TransportError> + Send + Sync + 'static,
    {
        Self {
            server_id,
            config,
            transport_factory: Box::new(transport_factory),
            retry_config,
            failover_config,
            connections: RwLock::new(Vec::new()),
            available: RwLock::new(Vec::new()),
            acquiring: RwLock::new(0),
            on_available: RwLock::new(Vec::new()),
        }
    }

    /// Acquire a connection from the pool
    pub async fn acquire(&self) -> Result<Arc<Connection>, ConnectionError> {
        // Try available connections first
        {
            let mut available = self.available.write().unwrap();
            while let Some(conn) = available.pop() {
                if conn.status() == ConnectionStatus::Connected {
                    return Ok(conn);
                }
                // Stale connection, destroy it
                let _ = conn.close().await;
            }
        }

        // Check pool limit
        if self.connections.read().unwrap().len() >= self.config.max_connections {
            // Wait for available connection
            let (tx, rx) = oneshot::channel();
            self.on_available.write().unwrap().push(Box::new(move |conn| {
                let _ = tx.send(conn);
            }));

            let result = tokio::time::timeout(self.config.acquire_timeout, rx).await;
            match result {
                Ok(Ok(conn)) => return Ok(conn),
                Ok(Err(_)) => return Err(ConnectionError::Internal("channel closed".into())),
                Err(_) => return Err(ConnectionError::PoolExhausted(self.server_id.clone())),
            }
        }

        // Create new connection
        *self.acquiring.write().unwrap() += 1;
        let transport = (self.transport_factory)()?;
        *self.acquiring.write().unwrap() -= 1;

        let conn = self.create_connection(transport).await?;
        self.connections.write().unwrap().push(conn.clone());
        Ok(conn)
    }

    /// Release a connection back to the pool
    pub fn release(&self, conn: Arc<Connection>) {
        if conn.status() == ConnectionStatus::Connected && !*conn.closed.read().unwrap() {
            self.available.write().unwrap().push(conn.clone());
            let handlers = self.on_available.read().unwrap().clone();
            for handler in handlers {
                handler(conn.clone());
            }
        } else {
            let conn = conn.clone();
            tokio::spawn(async move {
                let _ = conn.close().await;
            });
        }
    }

    async fn create_connection(&self, transport: Arc<dyn Transport>) -> Result<Arc<Connection>, ConnectionError> {
        let conn = Connection::new(
            self.server_id.clone(),
            transport,
            ServerCapabilities::default(),
            self.retry_config.clone(),
            self.failover_config.clone(),
        ).await?;

        // Initialize connection
        let init_result = conn.request("initialize", Some(serde_json::json!({
            "protocolVersion": "1.0",
            "capabilities": {},
            "clientInfo": {"name": "mcp-client", "version": "0.1.0"}
        }))).await?;

        if let Some(caps) = init_result.get("capabilities") {
            *conn.capabilities.write().unwrap() = serde_json::from_value(caps.clone()).unwrap_or_default();
        }

        conn.notify("initialized", Some(serde_json::json!({}))).await?;

        // Set up close handler
        let pool = self.clone_for_callback();
        conn.on_close(move |_| {
            pool.remove_connection(&conn);
        });

        Ok(conn)
    }

    fn remove_connection(&self, conn: &Arc<Connection>) {
        let mut connections = self.connections.write().unwrap();
        connections.retain(|c| !Arc::ptr_eq(c, conn));
        let mut available = self.available.write().unwrap();
        available.retain(|c| !Arc::ptr_eq(c, conn));
    }

    fn clone_for_callback(&self) -> Self {
        unimplemented!("Use Arc<ConnectionPool> instead")
    }

    /// Initialize the pool (pre-warm connections)
    pub async fn initialize(&self) -> Result<(), ConnectionError> {
        for _ in 0..self.config.min_connections {
            if let Ok(transport) = (self.transport_factory)() {
                if let Ok(conn) = self.create_connection(transport).await {
                    self.connections.write().unwrap().push(conn.clone());
                    self.available.write().unwrap().push(conn);
                }
            }
        }
        Ok(())
    }

    /// Shutdown the pool
    pub async fn shutdown(&self) -> Result<(), ConnectionError> {
        let connections: Vec<_> = self.connections.write().unwrap().drain(..).collect();
        for conn in connections {
            let _ = conn.close().await;
        }
        Ok(())
    }

    /// Get pool statistics
    pub fn stats(&self) -> PoolStats {
        PoolStats {
            total: self.connections.read().unwrap().len(),
            available: self.available.read().unwrap().len(),
            acquiring: *self.acquiring.read().unwrap(),
        }
    }
}

/// Pool statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PoolStats {
    pub total: usize,
    pub available: usize,
    pub acquiring: usize,
}

// ============================================================================
// Connection Manager Implementation
// ============================================================================

/// Manages multiple connection pools
pub struct ConnectionManager {
    pools: RwLock<HashMap<String, Arc<ConnectionPool>>>,
    configs: RwLock<HashMap<String, ConnectionConfig>>,
    contexts: RwLock<HashMap<String, McpContext>>,
    context_counter: AtomicU64,
    current_context: RwLock<Option<McpContext>>,
}

impl ConnectionManager {
    /// Create a new connection manager
    pub fn new() -> Self {
        Self {
            pools: RwLock::new(HashMap::new()),
            configs: RwLock::new(HashMap::new()),
            contexts: RwLock::new(HashMap::new()),
            context_counter: AtomicU64::new(0),
            current_context: RwLock::new(None),
        }
    }

    /// Connect to a server (creates pool if needed)
    pub async fn connect(&self, config: ConnectionConfig) -> Result<Arc<Connection>, ConnectionError> {
        let server_id = config.server_id.clone();
        self.configs.write().unwrap().insert(server_id.clone(), config);

        let pool = {
            let pools = self.pools.read().unwrap();
            pools.get(&server_id).cloned()
        };

        let pool = if let Some(pool) = pool {
            pool
        } else {
            let pool_config = PoolConfig::default();
            let retry_config = self.configs.read().unwrap().get(&server_id).and_then(|c| c.retry.clone()).unwrap_or_default();
            let failover_config = self.configs.read().unwrap().get(&server_id).and_then(|c| c.failover.clone()).unwrap_or_default();

            let transport_config = TransportConfig {
                transport_type: self.configs.read().unwrap().get(&server_id).map(|c| c.transport).unwrap_or(TransportType::Stdio),
                port: self.configs.read().unwrap().get(&server_id).and_then(|c| c.port),
                host: self.configs.read().unwrap().get(&server_id).and_then(|c| c.host.clone()),
                ..Default::default()
            };

            let transport_factory = move || create_transport(transport_config.clone());

            let pool = Arc::new(ConnectionPool::new(
                server_id.clone(),
                pool_config,
                transport_factory,
                retry_config,
                failover_config,
            ));

            pool.initialize().await?;

            self.pools.write().unwrap().insert(server_id.clone(), pool.clone());
            pool
        };

        pool.acquire().await
    }

    /// Get an existing connection
    pub fn get_connection(&self, server_id: &str) -> Option<Arc<Connection>> {
        let pools = self.pools.read().unwrap();
        pools.get(server_id).and_then(|p| {
            let available = p.available.read().unwrap();
            available.first().cloned()
        })
    }

    /// Get or create a connection
    pub async fn get_or_create_connection(&self, server_id: &str) -> Result<Arc<Connection>, ConnectionError> {
        let config = self.configs.read().unwrap().get(server_id).cloned()
            .ok_or_else(|| ConnectionError::NotConfigured(server_id.into()))?;
        self.connect(config).await
    }

    /// Create a new context
    pub fn create_context(&self, parent: Option<&McpContext>) -> McpContext {
        let id = format!("ctx-{}", self.context_counter.fetch_add(1, Ordering::SeqCst));
        let mut ctx = McpContext {
            request_id: id,
            parent_request_id: None,
            metadata: HashMap::new(),
            trace_id: None,
            span_id: None,
            tenant_id: None,
            user_id: None,
        };

        if let Some(parent) = parent {
            ctx.parent_request_id = Some(parent.request_id.clone());
            ctx.metadata = parent.metadata.clone();
            ctx.trace_id = parent.trace_id.clone();
            ctx.span_id = parent.span_id.clone();
            ctx.tenant_id = parent.tenant_id.clone();
            ctx.user_id = parent.user_id.clone();
        }

        self.contexts.write().unwrap().insert(ctx.request_id.clone(), ctx.clone());
        ctx
    }

    /// Get a context
    pub fn get_context(&self, context_id: &str) -> Option<McpContext> {
        self.contexts.read().unwrap().get(context_id).cloned()
    }

    /// Delete a context
    pub fn delete_context(&self, context_id: &str) {
        self.contexts.write().unwrap().remove(context_id);
    }

    /// Run a function with a context
    pub async fn run_with_context<F, T>(&self, ctx: McpContext, f: F) -> T
    where
        F: FnOnce() -> T,
    {
        *self.current_context.write().unwrap() = Some(ctx);
        let result = f();
        *self.current_context.write().unwrap() = None;
        result
    }

    // High-level operations

    /// Invoke a tool
    pub async fn invoke_tool(&self, server_id: &str, tool: &str, args: serde_json::Value) -> Result<CallToolResult, ConnectionError> {
        let conn = self.get_or_create_connection(server_id).await?;
        let result = conn.request("tools/call", Some(serde_json::json!({
            "name": tool,
            "arguments": args
        }))).await?;
        Ok(serde_json::from_value(result)?)
    }

    /// Read a resource
    pub async fn read_resource(&self, server_id: &str, uri: &str) -> Result<ReadResourceResult, ConnectionError> {
        let conn = self.get_or_create_connection(server_id).await?;
        let result = conn.request("resources/read", Some(serde_json::json!({"uri": uri}))).await?;
        Ok(serde_json::from_value(result)?)
    }

    /// Render a prompt
    pub async fn render_prompt(&self, server_id: &str, name: &str, args: serde_json::Value) -> Result<GetPromptResult, ConnectionError> {
        let conn = self.get_or_create_connection(server_id).await?;
        let result = conn.request("prompts/get", Some(serde_json::json!({
            "name": name,
            "arguments": args
        }))).await?;
        Ok(serde_json::from_value(result)?)
    }

    /// List tools
    pub async fn list_tools(&self, server_id: &str) -> Result<Vec<Tool>, ConnectionError> {
        let conn = self.get_or_create_connection(server_id).await?;
        let result = conn.request("tools/list", None).await?;
        Ok(serde_json::from_value(result)?)
    }

    /// List resources
    pub async fn list_resources(&self, server_id: &str) -> Result<Vec<Resource>, ConnectionError> {
        let conn = self.get_or_create_connection(server_id).await?;
        let result = conn.request("resources/list", None).await?;
        Ok(serde_json::from_value(result)?)
    }

    /// List prompts
    pub async fn list_prompts(&self, server_id: &str) -> Result<Vec<Prompt>, ConnectionError> {
        let conn = self.get_or_create_connection(server_id).await?;
        let result = conn.request("prompts/list", None).await?;
        Ok(serde_json::from_value(result)?)
    }

    /// Shutdown all pools
    pub async fn shutdown(&self) -> Result<(), ConnectionError> {
        let pools: Vec<_> = self.pools.write().unwrap().values().cloned().collect();
        for pool in pools {
            pool.shutdown().await?;
        }
        Ok(())
    }
}

impl Default for ConnectionManager {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// MCP Client Facade
// ============================================================================

/// High-level MCP client
pub struct McpClient {
    server_id: String,
    capabilities: ServerCapabilities,
    connection: Arc<Connection>,
    manager: Arc<ConnectionManager>,
}

impl McpClient {
    /// Create a new MCP client
    pub fn new(connection: Arc<Connection>, manager: Arc<ConnectionManager>, server_id: String) -> Self {
        let capabilities = connection.capabilities();
        Self {
            server_id,
            capabilities,
            connection,
            manager,
        }
    }

    pub fn server_id(&self) -> &str {
        &self.server_id
    }

    pub fn capabilities(&self) -> ServerCapabilities {
        self.capabilities.clone()
    }

    pub async fn list_tools(&self) -> Result<Vec<Tool>, ConnectionError> {
        self.manager.list_tools(&self.server_id).await
    }

    pub async fn call_tool(&self, name: &str, args: serde_json::Value) -> Result<CallToolResult, ConnectionError> {
        self.manager.invoke_tool(&self.server_id, name, args).await
    }

    pub async fn list_resources(&self) -> Result<Vec<Resource>, ConnectionError> {
        self.manager.list_resources(&self.server_id).await
    }

    pub async fn read_resource(&self, uri: &str) -> Result<ReadResourceResult, ConnectionError> {
        self.manager.read_resource(&self.server_id, uri).await
    }

    pub async fn list_prompts(&self) -> Result<Vec<Prompt>, ConnectionError> {
        self.manager.list_prompts(&self.server_id).await
    }

    pub async fn get_prompt(&self, name: &str, args: serde_json::Value) -> Result<GetPromptResult, ConnectionError> {
        self.manager.render_prompt(&self.server_id, name, args).await
    }

    pub async fn close(&self) -> Result<(), ConnectionError> {
        self.connection.close().await
    }
}

/// Connect to a server and return a client
pub async fn connect_to_server(
    manager: Arc<ConnectionManager>,
    config: ConnectionConfig,
) -> Result<McpClient, ConnectionError> {
    let connection = manager.connect(config.clone()).await?;
    Ok(McpClient::new(connection, manager, config.server_id))
}
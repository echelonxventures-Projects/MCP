//! mcp-server - MCP Server Framework for Rust

use std::collections::HashMap;
use std::sync::{Arc, RwLock, atomic::{AtomicU64, Ordering}};
use std::time::{Duration, Instant};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use schemars::JsonSchema;
use validator::Validate;
use thiserror::Error;
use tokio::sync::mpsc;
use futures::StreamExt;

use mcp_types::*;
use mcp_transports::{Transport, TransportConfig, TransportType, create_transport};

// ============================================================================
// Type Definitions
// ============================================================================

/// Tool definition for MCP server
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: JSONSchema,
    pub output_schema: Option<JSONSchema>,
    pub annotations: Option<ToolAnnotations>,
}

/// Context provided to tool handlers
#[derive(Debug, Clone)]
pub struct ToolContext {
    pub request_id: RequestId,
    pub client_info: ClientCapabilities,
    pub server_info: ServerInfo,
    pub cancel_signal: tokio::sync::watch::Receiver<()>,
}

/// Resource definition for MCP server
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ResourceDefinition {
    pub uri_pattern: String,
    pub name: String,
    pub description: Option<String>,
    pub mime_type: Option<String>,
    pub annotations: Option<ResourceAnnotations>,
}

/// Parsed URI with extracted parameters
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ParsedUri {
    pub href: String,
    pub pattern: String,
    pub params: HashMap<String, String>,
}

/// Context provided to resource handlers
#[derive(Debug, Clone)]
pub struct ResourceContext {
    pub request_id: RequestId,
    pub client_info: ClientCapabilities,
}

/// Prompt definition for MCP server
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct PromptDefinition {
    pub name: String,
    pub description: Option<String>,
    pub arguments: Option<Vec<PromptArgument>>,
}

/// Context provided to prompt handlers
#[derive(Debug, Clone)]
pub struct PromptContext {
    pub request_id: RequestId,
    pub client_info: ClientCapabilities,
}

/// Server information
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ServerInfo {
    pub name: String,
    pub version: String,
    pub capabilities: ServerCapabilities,
}

/// Server startup configuration
#[derive(Debug, Clone)]
pub struct ServerStartConfig {
    pub transport: TransportType,
    pub port: Option<u16>,
    pub host: Option<String>,
}

/// Server errors
#[derive(Debug, Error)]
pub enum ServerError {
    #[error("server already started")]
    AlreadyStarted,
    #[error("server not started")]
    NotStarted,
    #[error("tool not found: {0}")]
    ToolNotFound(String),
    #[error("resource not found: {0}")]
    ResourceNotFound(String),
    #[error("prompt not found: {0}")]
    PromptNotFound(String),
    #[error("transport error: {0}")]
    TransportError(#[from] mcp_transports::TransportError),
    #[error("JSON error: {0}")]
    JsonError(#[from] serde_json::Error),
    #[error("internal error: {0}")]
    Internal(String),
}

/// Middleware trait for server
#[async_trait]
pub trait ServerMiddleware: Send + Sync {
    async fn on_request(&self, ctx: &mut RequestContext, next: Box<dyn FnOnce() -> BoxFuture<'_, ()> + Send>) -> Result<(), ServerError>;
    async fn on_response(&self, ctx: &mut ResponseContext, next: Box<dyn FnOnce() -> BoxFuture<'_, ()> + Send>) -> Result<(), ServerError>;
    async fn on_error(&self, ctx: &mut ErrorContext, err: &ServerError, next: Box<dyn FnOnce() -> BoxFuture<'_, ()> + Send>) -> Result<(), ServerError>;
    async fn on_connect(&self, ctx: &ConnectionContext) -> Result<(), ServerError>;
    async fn on_disconnect(&self, ctx: &ConnectionContext, error: Option<&ServerError>) -> Result<(), ServerError>;
}

type BoxFuture<'a, T> = std::pin::Pin<Box<dyn std::future::Future<Output = T> + Send + 'a>>;

/// Request context for middleware
#[derive(Debug)]
pub struct RequestContext {
    pub request_id: RequestId,
    pub method: String,
    pub params: Option<serde_json::Value>,
    pub client_caps: ClientCapabilities,
    pub server_caps: ServerCapabilities,
    pub transport: Arc<dyn Transport>,
    pub start_time: Instant,
    pub message: MCPMessage,
}

/// Response context for middleware
#[derive(Debug)]
pub struct ResponseContext {
    pub request: RequestContext,
    pub response: MCPMessage,
}

/// Error context for middleware
#[derive(Debug)]
pub struct ErrorContext {
    pub request: RequestContext,
    pub error: ServerError,
}

/// Connection context for middleware
#[derive(Debug, Clone)]
pub struct ConnectionContext {
    pub connection_id: String,
    pub transport: Arc<dyn Transport>,
    pub client_caps: Option<ClientCapabilities>,
    pub server_caps: ServerCapabilities,
    pub metadata: HashMap<String, serde_json::Value>,
}

// ============================================================================
// Server Implementation
// ============================================================================

/// Main MCP server implementation
pub struct McpServer {
    name: String,
    version: String,
    capabilities: ServerCapabilities,

    tools: RwLock<HashMap<String, ToolDefinition>>,
    resources: RwLock<HashMap<String, ResourceDefinition>>,
    prompts: RwLock<HashMap<String, PromptDefinition>>,
    middlewares: Vec<Arc<dyn ServerMiddleware>>,

    transport: RwLock<Option<Arc<dyn Transport>>>,
    connections: RwLock<HashMap<String, ConnectionContext>>,
    conn_counter: AtomicU64,

    initialized: RwLock<bool>,
    client_caps: RwLock<Option<ClientCapabilities>>,
    shutdown_tx: RwLock<Option<mpsc::Sender<()>>>,
}

impl McpServer {
    /// Create a new MCP server
    pub fn new(name: impl Into<String>, version: impl Into<String>, capabilities: ServerCapabilities) -> Self {
        Self {
            name: name.into(),
            version: version.into(),
            capabilities,
            tools: RwLock::new(HashMap::new()),
            resources: RwLock::new(HashMap::new()),
            prompts: RwLock::new(HashMap::new()),
            middlewares: Vec::new(),
            transport: RwLock::new(None),
            connections: RwLock::new(HashMap::new()),
            conn_counter: AtomicU64::new(0),
            initialized: RwLock::new(false),
            client_caps: RwLock::new(None),
            shutdown_tx: RwLock::new(None),
        }
    }

    /// Register a tool
    pub fn tool(&self, def: ToolDefinition) -> Result<&Self, ServerError> {
        let mut tools = self.tools.write().unwrap();
        if tools.contains_key(&def.name) {
            return Err(ServerError::ToolNotFound(def.name));
        }
        tools.insert(def.name.clone(), def);
        Ok(self)
    }

    /// Register a resource
    pub fn resource(&self, def: ResourceDefinition) -> Result<&Self, ServerError> {
        let mut resources = self.resources.write().unwrap();
        if resources.contains_key(&def.uri_pattern) {
            return Err(ServerError::ResourceNotFound(def.uri_pattern));
        }
        resources.insert(def.uri_pattern.clone(), def);
        Ok(self)
    }

    /// Register a prompt
    pub fn prompt(&self, def: PromptDefinition) -> Result<&Self, ServerError> {
        let mut prompts = self.prompts.write().unwrap();
        if prompts.contains_key(&def.name) {
            return Err(ServerError::PromptNotFound(def.name));
        }
        prompts.insert(def.name.clone(), def);
        Ok(self)
    }

    /// Add middleware
    pub fn use_middleware(&self, middleware: Arc<dyn ServerMiddleware>) -> &Self {
        // Note: In real implementation, we'd need interior mutability
        // For now, this is a placeholder
        self
    }

    /// Start the server
    pub async fn start(&self, config: ServerStartConfig) -> Result<(), ServerError> {
        let mut transport_guard = self.transport.write().unwrap();
        if transport_guard.is_some() {
            return Err(ServerError::AlreadyStarted);
        }

        let transport_config = TransportConfig {
            transport_type: config.transport,
            port: config.port,
            host: config.host,
            ..Default::default()
        };

        let transport = Arc::new(create_transport(transport_config).await?);

        // Set up transport event handlers
        let server = self.clone_for_callbacks();
        transport.set_on_connect(Box::new(move || {
            let server = server.clone();
            Box::pin(async move { server.handle_connect().await })
        }));

        let server = self.clone_for_callbacks();
        transport.set_on_disconnect(Box::new(move |err| {
            let server = server.clone();
            Box::pin(async move { server.handle_disconnect(err).await })
        }));

        let server = self.clone_for_callbacks();
        transport.set_on_error(Box::new(move |err| {
            let server = server.clone();
            Box::pin(async move { server.handle_transport_error(err).await })
        }));

        transport.connect().await?;
        *transport_guard = Some(transport.clone());

        // Start message loop
        let (shutdown_tx, mut shutdown_rx) = mpsc::channel(1);
        *self.shutdown_tx.write().unwrap() = Some(shutdown_tx);

        let transport = transport.clone();
        let server = self.clone_for_callbacks();
        tokio::spawn(async move {
            let mut messages = transport.receive();
            loop {
                tokio::select! {
                    _ = shutdown_rx.recv() => break,
                    msg = messages.next() => {
                        if let Some(msg) = msg {
                            server.handle_message(msg).await;
                        } else {
                            break;
                        }
                    }
                }
            }
        });

        Ok(())
    }

    /// Stop the server
    pub async fn stop(&self) -> Result<(), ServerError> {
        let mut transport_guard = self.transport.write().unwrap();
        let transport = transport_guard.take();
        drop(transport_guard);

        if let Some(transport) = transport {
            // Close all connections
            let connections: Vec<_> = {
                let mut conns = self.connections.write().unwrap();
                conns.drain().collect()
            };

            for (id, ctx) in connections {
                self.close_connection(&id, ServerError::Internal("server stopping".into())).await?;
            }

            transport.disconnect().await?;
        }

        *self.initialized.write().unwrap() = false;
        *self.client_caps.write().unwrap() = None;

        if let Some(tx) = self.shutdown_tx.write().unwrap().take() {
            let _ = tx.send(()).await;
        }

        Ok(())
    }

    // Message handling

    async fn handle_message(&self, message: MCPMessage) {
        let request_id = message.id.clone().unwrap_or_else(|| RequestId::new(uuid::Uuid::new_v4().to_string()));

        let req_ctx = RequestContext {
            request_id: request_id.clone(),
            method: message.method.clone().unwrap_or_default(),
            params: message.params.clone(),
            client_caps: self.client_caps.read().unwrap().clone().unwrap_or_default(),
            server_caps: self.capabilities.clone(),
            transport: self.transport.read().unwrap().as_ref().unwrap().clone(),
            start_time: Instant::now(),
            message: message.clone(),
        };

        // Run request middleware
        if let Err(err) = self.run_request_middleware(&req_ctx).await {
            self.send_error(&req_ctx, &err).await;
            return;
        }

        // Dispatch message
        let response = match self.dispatch_message(message).await {
            Ok(resp) => resp,
            Err(err) => {
                self.send_error(&req_ctx, &err).await;
                return;
            }
        };

        if let Some(response) = response {
            let resp_ctx = ResponseContext {
                request: req_ctx,
                response: response.clone(),
            };

            if let Err(err) = self.run_response_middleware(&resp_ctx).await {
                self.send_error(&resp_ctx.request, &err).await;
                return;
            }

            if let Some(transport) = self.transport.read().unwrap().as_ref() {
                if let Err(err) = transport.send(response).await {
                    tracing::error!("Failed to send response: {}", err);
                }
            }
        }
    }

    async fn dispatch_message(&self, message: MCPMessage) -> Result<Option<MCPMessage>, ServerError> {
        if message.is_notification() {
            self.handle_notification(message).await;
            return Ok(None);
        }

        if !message.is_request() {
            return Err(ServerError::Internal("not a request".into()));
        }

        let method = message.method.as_deref().unwrap_or("");
        let id = message.id.clone();

        match method {
            "initialize" => Ok(Some(self.handle_initialize(message).await?)),
            "tools/list" => Ok(Some(self.create_response(id, self.handle_list_tools().await?))),
            "tools/call" => Ok(Some(self.create_response(id, self.handle_call_tool(message).await?))),
            "resources/list" => Ok(Some(self.create_response(id, self.handle_list_resources(message).await?))),
            "resources/read" => Ok(Some(self.create_response(id, self.handle_read_resource(message).await?))),
            "resources/subscribe" => Ok(Some(self.create_response(id, serde_json::json!({"subscribed": true})))),
            "resources/unsubscribe" => Ok(Some(self.create_response(id, serde_json::json!({"unsubscribed": true})))),
            "prompts/list" => Ok(Some(self.create_response(id, self.handle_list_prompts(message).await?))),
            "prompts/get" => Ok(Some(self.create_response(id, self.handle_get_prompt(message).await?))),
            "ping" => Ok(Some(self.create_response(id, serde_json::json!({})))),
            _ => Err(ServerError::Internal(format!("method not found: {}", method))),
        }
    }

    async fn handle_notification(&self, message: MCPMessage) {
        match message.method.as_deref() {
            Some("initialized") => {
                *self.initialized.write().unwrap() = true;
            }
            Some("cancelled") => {
                // Handle cancellation
            }
            _ => {}
        }
    }

    async fn handle_initialize(&self, message: MCPMessage) -> Result<MCPMessage, ServerError> {
        let params: serde_json::Value = message.params.unwrap_or(serde_json::json!({}));
        let caps: ClientCapabilities = serde_json::from_value(params.get("capabilities").cloned().unwrap_or(serde_json::json!({})))?;

        *self.client_caps.write().unwrap() = Some(caps);
        *self.initialized.write().unwrap() = true;

        Ok(self.create_response(message.id, serde_json::json!({
            "protocolVersion": "1.0",
            "capabilities": self.capabilities,
            "serverInfo": {
                "name": self.name,
                "version": self.version,
            }
        }))?)
    }

    async fn handle_list_tools(&self) -> Result<ListToolsResult, ServerError> {
        let tools = self.tools.read().unwrap();
        let result = tools.values().map(|t| Tool {
            name: t.name.clone(),
            description: t.description.clone(),
            input_schema: t.input_schema.clone(),
            output_schema: t.output_schema.clone(),
            annotations: t.annotations.clone(),
        }).collect();
        Ok(ListToolsResult { tools: result })
    }

    async fn handle_call_tool(&self, message: MCPMessage) -> Result<CallToolResult, ServerError> {
        let params: serde_json::Value = message.params.unwrap_or(serde_json::json!({}));
        let name = params.get("name").and_then(|v| v.as_str()).ok_or_else(|| ServerError::Internal("missing tool name".into()))?;
        let args = params.get("arguments").cloned().unwrap_or(serde_json::json!({}));

        let tool = self.tools.read().unwrap().get(name).cloned()
            .ok_or_else(|| ServerError::ToolNotFound(name.into()))?;

        let ctx = ToolContext {
            request_id: message.id.clone().unwrap_or_else(|| RequestId::new(uuid::Uuid::new_v4().to_string())),
            client_info: self.client_caps.read().unwrap().clone().unwrap_or_default(),
            server_info: ServerInfo {
                name: self.name.clone(),
                version: self.version.clone(),
                capabilities: self.capabilities.clone(),
            },
            cancel_signal: tokio::sync::watch::channel(()).1,
        };

        // In real implementation, call the actual handler
        Ok(CallToolResult {
            content: vec![ResourceContents {
                uri: "".into(),
                mime_type: "text/plain".into(),
                text: Some(format!("Tool {} executed", name)),
                blob: None,
            }],
            is_error: Some(false),
        })
    }

    async fn handle_list_resources(&self, _message: MCPMessage) -> Result<ListResourcesResult, ServerError> {
        let resources = self.resources.read().unwrap();
        let result = resources.values().map(|r| Resource {
            uri: r.uri_pattern.clone(),
            name: r.name.clone(),
            description: r.description.clone(),
            mime_type: r.mime_type.clone(),
            annotations: r.annotations.clone(),
        }).collect();
        Ok(ListResourcesResult { resources: result })
    }

    async fn handle_read_resource(&self, message: MCPMessage) -> Result<ReadResourceResult, ServerError> {
        let params: serde_json::Value = message.params.unwrap_or(serde_json::json!({}));
        let uri = params.get("uri").and_then(|v| v.as_str()).ok_or_else(|| ServerError::Internal("missing uri".into()))?;

        let resources = self.resources.read().unwrap();
        for (pattern, resource) in resources.iter() {
            if let Some(parsed) = self.parse_uri(pattern, uri) {
                let ctx = ResourceContext {
                    request_id: message.id.clone().unwrap_or_else(|| RequestId::new(uuid::Uuid::new_v4().to_string())),
                    client_info: self.client_caps.read().unwrap().clone().unwrap_or_default(),
                };
                // In real implementation, call the actual handler
                return Ok(ReadResourceResult {
                    contents: vec![ResourceContents {
                        uri: uri.into(),
                        mime_type: resource.mime_type.clone().unwrap_or("text/plain".into()),
                        text: Some(format!("Resource {} content", uri)),
                        blob: None,
                    }],
                });
            }
        }

        Err(ServerError::ResourceNotFound(uri.into()))
    }

    async fn handle_list_prompts(&self, _message: MCPMessage) -> Result<ListPromptsResult, ServerError> {
        let prompts = self.prompts.read().unwrap();
        let result = prompts.values().map(|p| Prompt {
            name: p.name.clone(),
            description: p.description.clone(),
            arguments: p.arguments.clone(),
        }).collect();
        Ok(ListPromptsResult { prompts: result })
    }

    async fn handle_get_prompt(&self, message: MCPMessage) -> Result<GetPromptResult, ServerError> {
        let params: serde_json::Value = message.params.unwrap_or(serde_json::json!({}));
        let name = params.get("name").and_then(|v| v.as_str()).ok_or_else(|| ServerError::Internal("missing prompt name".into()))?;

        let prompt = self.prompts.read().unwrap().get(name).cloned()
            .ok_or_else(|| ServerError::PromptNotFound(name.into()))?;

        let ctx = PromptContext {
            request_id: message.id.clone().unwrap_or_else(|| RequestId::new(uuid::Uuid::new_v4().to_string())),
            client_info: self.client_caps.read().unwrap().clone().unwrap_or_default(),
        };

        // In real implementation, call the actual handler
        Ok(GetPromptResult {
            description: prompt.description,
            messages: vec![PromptMessage {
                role: "user".into(),
                content: PromptMessageContent::Text(format!("Prompt {} rendered", name)),
            }],
        })
    }

    fn parse_uri(&self, pattern: &str, uri: &str) -> Option<ParsedUri> {
        // Simple pattern matching
        Some(ParsedUri {
            href: uri.into(),
            pattern: pattern.into(),
            params: HashMap::new(),
        })
    }

    fn create_response(&self, id: Option<RequestId>, result: impl Serialize) -> Result<MCPMessage, ServerError> {
        Ok(MCPMessage {
            jsonrpc: "2.0".into(),
            id,
            result: Some(serde_json::to_value(result)?),
            error: None,
            method: None,
            params: None,
        })
    }

    async fn send_error(&self, req_ctx: &RequestContext, err: &ServerError) {
        let error_response = MCPMessage {
            jsonrpc: "2.0".into(),
            id: Some(req_ctx.request_id.clone()),
            result: None,
            error: Some(MCPError {
                code: -32603,
                message: err.to_string(),
                data: None,
            }),
            method: None,
            params: None,
        };

        if let Some(transport) = self.transport.read().unwrap().as_ref() {
            if let Err(e) = transport.send(error_response).await {
                tracing::error!("Failed to send error response: {}", e);
            }
        }
    }

    async fn run_request_middleware(&self, _ctx: &RequestContext) -> Result<(), ServerError> {
        Ok(())
    }

    async fn run_response_middleware(&self, _ctx: &ResponseContext) -> Result<(), ServerError> {
        Ok(())
    }

    async fn handle_connect(&self) {
        let id = format!("conn-{}", self.conn_counter.fetch_add(1, Ordering::SeqCst));
        let ctx = ConnectionContext {
            connection_id: id.clone(),
            transport: self.transport.read().unwrap().as_ref().unwrap().clone(),
            client_caps: self.client_caps.read().unwrap().clone(),
            server_caps: self.capabilities.clone(),
            metadata: HashMap::new(),
        };
        self.connections.write().unwrap().insert(id, ctx);
    }

    async fn handle_disconnect(&self, error: Option<ServerError>) {
        let connections: Vec<_> = {
            let mut conns = self.connections.write().unwrap();
            conns.drain().collect()
        };

        for (id, ctx) in connections {
            for middleware in &self.middlewares {
                let _ = middleware.on_disconnect(&ctx, error.as_ref()).await;
            }
        }
    }

    async fn handle_transport_error(&self, _error: mcp_transports::TransportError) {
        // Log error
    }

    async fn close_connection(&self, id: &str, error: ServerError) -> Result<(), ServerError> {
        if let Some(ctx) = self.connections.write().unwrap().remove(id) {
            for middleware in &self.middlewares {
                let _ = middleware.on_disconnect(&ctx, Some(&error)).await;
            }
        }
        Ok(())
    }

    // Helper for callbacks (in real implementation, use Arc<Self>)
    fn clone_for_callbacks(&self) -> Self {
        // This is a simplified version - real implementation would use Arc
        Self {
            name: self.name.clone(),
            version: self.version.clone(),
            capabilities: self.capabilities.clone(),
            tools: RwLock::new(HashMap::new()),
            resources: RwLock::new(HashMap::new()),
            prompts: RwLock::new(HashMap::new()),
            middlewares: Vec::new(),
            transport: RwLock::new(None),
            connections: RwLock::new(HashMap::new()),
            conn_counter: AtomicU64::new(0),
            initialized: RwLock::new(false),
            client_caps: RwLock::new(None),
            shutdown_tx: RwLock::new(None),
        }
    }

    // Public API

    pub fn get_tools(&self) -> Vec<ToolDefinition> {
        self.tools.read().unwrap().values().cloned().collect()
    }

    pub fn get_resources(&self) -> Vec<ResourceDefinition> {
        self.resources.read().unwrap().values().cloned().collect()
    }

    pub fn get_prompts(&self) -> Vec<PromptDefinition> {
        self.prompts.read().unwrap().values().cloned().collect()
    }

    pub fn get_server_info(&self) -> ServerInfo {
        ServerInfo {
            name: self.name.clone(),
            version: self.version.clone(),
            capabilities: self.capabilities.clone(),
        }
    }

    pub fn is_initialized(&self) -> bool {
        *self.initialized.read().unwrap()
    }

    pub fn get_connection_count(&self) -> usize {
        self.connections.read().unwrap().len()
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Create a tool definition
pub fn tool(
    name: impl Into<String>,
    description: impl Into<String>,
    input_schema: JSONSchema,
    handler: impl Fn(serde_json::Value, ToolContext) -> Result<CallToolResult, ServerError> + Send + Sync + 'static,
) -> ToolDefinition {
    ToolDefinition {
        name: name.into(),
        description: description.into(),
        input_schema,
        output_schema: None,
        annotations: None,
    }
}

/// Create a resource definition
pub fn resource(
    uri_pattern: impl Into<String>,
    name: impl Into<String>,
    handler: impl Fn(ParsedUri, ResourceContext) -> Result<ReadResourceResult, ServerError> + Send + Sync + 'static,
) -> ResourceDefinition {
    ResourceDefinition {
        uri_pattern: uri_pattern.into(),
        name: name.into(),
        description: None,
        mime_type: None,
        annotations: None,
    }
}

/// Create a prompt definition
pub fn prompt(
    name: impl Into<String>,
    handler: impl Fn(serde_json::Value, PromptContext) -> Result<GetPromptResult, ServerError> + Send + Sync + 'static,
) -> PromptDefinition {
    PromptDefinition {
        name: name.into(),
        description: None,
        arguments: None,
    }
}
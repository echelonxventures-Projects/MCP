//! Basic MCP Server in Rust

use mcp_server::{McpServer, ToolHandler, ResourceHandler, PromptHandler, ToolSchema, ResourceSchema, PromptSchema};
use mcp_transport::{Transport, StdioTransport, WebSocketTransport, HttpSseTransport};
use mcp_types::{Tool, Resource, Prompt, JsonRpcRequest, JsonRpcResponse, JsonRpcError, ServerCapabilities};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tracing::{info, error};

// ============================================
// TOOL HANDLERS
// ============================================

struct EchoTool;
impl ToolHandler for EchoTool {
    fn name(&self) -> &str { "echo" }
    fn description(&self) -> &str { "Echo message back" }
    fn schema(&self) -> ToolSchema {
        ToolSchema {
            name: "echo",
            description: "Echo message back",
            input_schema: r#"{"type":"object","properties":{"message":{"type":"string"},"count":{"type":"integer","minimum":1,"default":1}},"required":["message"]}"#,
            output_schema: None,
            annotations: None,
        }
    }
    async fn call(&self, args: &[u8], output: &mut Vec<u8>) -> Result<(), JsonRpcError> {
        #[derive(Deserialize)]
        struct Args { message: String, count: Option<u32> }

        let args: Args = serde_json::from_slice(args).map_err(|_| JsonRpcError::parse_error())?;
        let count = args.count.unwrap_or(1);
        let result = args.message.repeat(count as usize);

        let response = JsonRpcResponse {
            jsonrpc: "2.0",
            id: Some(json!(null)),
            result: Some(json!({"content": [{"type": "text", "text": result}]})),
            error: None,
        };

        let bytes = serde_json::to_vec(&response).map_err(|_| JsonRpcError::internal_error())?;
        output.extend_from_slice(&bytes);
        Ok(())
    }
}

struct HashTool;
impl ToolHandler for HashTool {
    fn name(&self) -> &str { "hash" }
    fn description(&self) -> &str { "SHA256 hash" }
    fn schema(&self) -> ToolSchema {
        ToolSchema {
            name: "hash",
            description: "SHA256 hash",
            input_schema: r#"{"type":"object","properties":{"input":{"type":"string"}},"required":["input"]}"#,
            output_schema: None,
            annotations: None,
        }
    }
    async fn call(&self, args: &[u8], output: &mut Vec<u8>) -> Result<(), JsonRpcError> {
        #[derive(Deserialize)]
        struct Args { input: String }

        let args: Args = serde_json::from_slice(args).map_err(|_| JsonRpcError::parse_error())?;
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(args.input.as_bytes());
        let hash = hasher.finalize();

        let response = JsonRpcResponse {
            jsonrpc: "2.0",
            id: Some(json!(null)),
            result: Some(json!({"content": [{"type": "text", "text": format!("{:x}", hash)}]})),
            error: None,
        };

        let bytes = serde_json::to_vec(&response).map_err(|_| JsonRpcError::internal_error())?;
        output.extend_from_slice(&bytes);
        Ok(())
    }
}

struct HealthTool;
impl ToolHandler for HealthTool {
    fn name(&self) -> &str { "health" }
    fn description(&self) -> &str { "Health check" }
    fn schema(&self) -> ToolSchema {
        ToolSchema {
            name: "health",
            description: "Health check",
            input_schema: r#"{"type":"object","properties":{}}"#,
            output_schema: None,
            annotations: None,
        }
    }
    async fn call(&self, _args: &[u8], output: &mut Vec<u8>) -> Result<(), JsonRpcError> {
        let response = JsonRpcResponse {
            jsonrpc: "2.0",
            id: Some(json!(null)),
            result: Some(json!({"content": [{"type": "text", "text": json!({"status": "healthy", "timestamp": chrono::Utc::now().to_rfc3339()}).to_string()}]})),
            error: None,
        };

        let bytes = serde_json::to_vec(&response).map_err(|_| JsonRpcError::internal_error())?;
        output.extend_from_slice(&bytes);
        Ok(())
    }
}

// ============================================
// RESOURCE HANDLERS
// ============================================

struct InfoResource;
impl ResourceHandler for InfoResource {
    fn uri_pattern(&self) -> &str { "info://server" }
    fn name(&self) -> &str { "Server Info" }
    fn mime_type(&self) -> &str { "application/json" }
    fn schema(&self) -> ResourceSchema {
        ResourceSchema {
            uri_pattern: "info://server",
            name: "Server Info",
            description: "Server information",
            mime_type: "application/json",
            annotations: None,
        }
    }
    async fn read(&self, _uri: &str, output: &mut Vec<u8>) -> Result<(), JsonRpcError> {
        let response = json!({
            "name": "basic-server",
            "version": "1.0.0",
            "rust_version": env!("RUSTC_VERSION"),
        });
        let bytes = serde_json::to_vec_pretty(&response).map_err(|_| JsonRpcError::internal_error())?;
        output.extend_from_slice(&bytes);
        Ok(())
    }
}

struct TimeResource;
impl ResourceHandler for TimeResource {
    fn uri_pattern(&self) -> &str { "time://now" }
    fn name(&self) -> &str { "Current Time" }
    fn mime_type(&self) -> &str { "application/json" }
    fn schema(&self) -> ResourceSchema {
        ResourceSchema {
            uri_pattern: "time://now",
            name: "Current Time",
            description: "Current timestamp",
            mime_type: "application/json",
            annotations: None,
        }
    }
    async fn read(&self, _uri: &str, output: &mut Vec<u8>) -> Result<(), JsonRpcError> {
        let now = chrono::Utc::now();
        let response = json!({
            "iso": now.to_rfc3339(),
            "timestamp": now.timestamp(),
        });
        let bytes = serde_json::to_vec_pretty(&response).map_err(|_| JsonRpcError::internal_error())?;
        output.extend_from_slice(&bytes);
        Ok(())
    }
}

// ============================================
// PROMPT HANDLERS
// ============================================

struct AssistantPrompt;
impl PromptHandler for AssistantPrompt {
    fn name(&self) -> &str { "assistant" }
    fn description(&self) -> &str { "General assistant" }
    fn schema(&self) -> PromptSchema {
        PromptSchema {
            name: "assistant",
            description: "General assistant prompt",
            arguments: r#"[{"name":"task","type":"string","required":true}]"#,
        }
    }
    async fn render(&self, args: &[u8], output: &mut Vec<u8>) -> Result<(), JsonRpcError> {
        #[derive(Deserialize)]
        struct Args { task: String }
        let args: Args = serde_json::from_slice(args).map_err(|_| JsonRpcError::parse_error())?;

        let prompt = format!("You are a helpful assistant. Help with: {}", args.task);
        output.extend_from_slice(prompt.as_bytes());
        Ok(())
    }
}

// ============================================
// MAIN
// ============================================

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt::init();

    let transport_type = std::env::var("MCP_TRANSPORT").unwrap_or_else(|_| "websocket".to_string());
    let port = std::env::var("MCP_PORT").unwrap_or_else(|_| "3000".to_string());
    let host = std::env::var("MCP_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());

    info!("Starting basic-server on {}...", transport_type);

    // Create server
    let server = McpServer::new(
        "basic-server",
        "1.0.0",
        vec![
            Box::new(EchoTool),
            Box::new(HashTool),
            Box::new(HealthTool),
        ],
        vec![
            Box::new(InfoResource),
            Box::new(TimeResource),
        ],
        vec![
            Box::new(AssistantPrompt),
        ],
    );

    // Initialize transport
    let transport: Box<dyn Transport> = match transport_type.as_str() {
        "websocket" => Box::new(WebSocketTransport::new(format!("{}:{}", host, port)).await?),
        "http-sse" => Box::new(HttpSseTransport::new(format!("{}:{}", host, port)).await?),
        "stdio" => Box::new(StdioTransport::new()),
        _ => return Err("Unknown transport".into()),
    };

    // Run server
    server.run(transport).await?;

    info!("Basic server started");
    Ok(())
}
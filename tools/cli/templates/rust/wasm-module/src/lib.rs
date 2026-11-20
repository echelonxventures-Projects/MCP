//! MCP Server as WebAssembly Module
//! Runs in browsers (Web Workers) and WASI environments

use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

// ============================================
// TYPES
// ============================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tool {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
    pub output_schema: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Resource {
    pub uri: String,
    pub name: String,
    pub description: Option<String>,
    pub mime_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Prompt {
    pub name: String,
    pub description: Option<String>,
    pub arguments: Vec<PromptArgument>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptArgument {
    pub name: String,
    pub description: Option<String>,
    pub required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: Option<serde_json::Value>,
    pub method: String,
    pub params: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerCapabilities {
    pub tools: Option<ToolsCapability>,
    pub resources: Option<ResourcesCapability>,
    pub prompts: Option<PromptsCapability>,
    pub logging: Option<LoggingCapability>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolsCapability {
    pub list_changed: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourcesCapability {
    pub subscribe: Option<bool>,
    pub list_changed: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptsCapability {
    pub list_changed: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoggingCapability {}

// ============================================
// SERVER STATE
// ============================================

struct ServerState {
    name: String,
    version: String,
    capabilities: ServerCapabilities,
    tools: Vec<Tool>,
    resources: Vec<Resource>,
    prompts: Vec<Prompt>,
    tool_handlers: HashMap<String, Box<dyn ToolHandler + Send + Sync>>,
    resource_handlers: HashMap<String, Box<dyn ResourceHandler + Send + Sync>>,
    prompt_handlers: HashMap<String, Box<dyn PromptHandler + Send + Sync>>,
}

trait ToolHandler: Send + Sync {
    fn call(&self, args: serde_json::Value) -> Result<serde_json::Value, JsonRpcError>;
}

trait ResourceHandler: Send + Sync {
    fn read(&self, uri: &str) -> Result<serde_json::Value, JsonRpcError>;
}

trait PromptHandler: Send + Sync {
    fn render(&self, args: serde_json::Value) -> Result<serde_json::Value, JsonRpcError>;
}

impl ServerState {
    fn new(name: &str, version: &str) -> Self {
        Self {
            name: name.to_string(),
            version: version.to_string(),
            capabilities: ServerCapabilities {
                tools: Some(ToolsCapability { list_changed: Some(true) }),
                resources: Some(ResourcesCapability { subscribe: Some(true), list_changed: Some(true) }),
                prompts: Some(PromptsCapability { list_changed: Some(true) }),
                logging: Some(LoggingCapability {}),
            },
            tools: Vec::new(),
            resources: Vec::new(),
            prompts: Vec::new(),
            tool_handlers: HashMap::new(),
            resource_handlers: HashMap::new(),
            prompt_handlers: HashMap::new(),
        }
    }

    fn add_tool(&mut self, tool: Tool, handler: Box<dyn ToolHandler + Send + Sync>) {
        self.tools.push(tool.clone());
        self.tool_handlers.insert(tool.name, handler);
    }

    fn add_resource(&mut self, resource: Resource, handler: Box<dyn ResourceHandler + Send + Sync>) {
        self.resources.push(resource.clone());
        self.resource_handlers.insert(resource.uri.clone(), handler);
    }

    fn add_prompt(&mut self, prompt: Prompt, handler: Box<dyn PromptHandler + Send + Sync>) {
        self.prompts.push(prompt.clone());
        self.prompt_handlers.insert(prompt.name, handler);
    }
}

// Global server instance
static SERVER: Mutex<Option<Arc<Mutex<ServerState>>>> = Mutex::new(None);

// ============================================
// BUILT-IN TOOLS
// ============================================

struct EchoTool;
impl ToolHandler for EchoTool {
    fn call(&self, args: serde_json::Value) -> Result<serde_json::Value, JsonRpcError> {
        let message = args.get("message").and_then(|v| v.as_str()).unwrap_or("");
        let count = args.get("count").and_then(|v| v.as_u64()).unwrap_or(1) as usize;
        let result = message.repeat(count);
        Ok(serde_json::json!({
            "content": [{"type": "text", "text": result}]
        }))
    }
}

struct HashTool;
impl ToolHandler for HashTool {
    fn call(&self, args: serde_json::Value) -> Result<serde_json::Value, JsonRpcError> {
        let input = args.get("input").and_then(|v| v.as_str()).unwrap_or("");
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(input.as_bytes());
        let hash = hasher.finalize();
        Ok(serde_json::json!({
            "content": [{"type": "text", "text": format!("{:x}", hash)}]
        }))
    }
}

struct UuidTool;
impl ToolHandler for UuidTool {
    fn call(&self, _args: serde_json::Value) -> Result<serde_json::Value, JsonRpcError> {
        let uuid = js_sys::crypto::random_uuid().unwrap_or_else(|_| "00000000-0000-0000-0000-000000000000".into());
        Ok(serde_json::json!({
            "content": [{"type": "text", "text": uuid.as_string().unwrap()}]
        }))
    }
}

struct HealthTool;
impl ToolHandler for HealthTool {
    fn call(&self, _args: serde_json::Value) -> Result<serde_json::Value, JsonRpcError> {
        Ok(serde_json::json!({
            "content": [{
                "type": "text",
                "text": serde_json::to_string_pretty(&serde_json::json!({
                    "status": "healthy",
                    "timestamp": js_sys::Date::now().to_string(),
                    "runtime": "wasm"
                })).unwrap()
            }]
        }))
    }
}

// ============================================
// BUILT-IN RESOURCES
// ============================================

struct InfoResource;
impl ResourceHandler for InfoResource {
    fn read(&self, _uri: &str) -> Result<serde_json::Value, JsonRpcError> {
        let server = SERVER.lock().unwrap();
        let server = server.as_ref().unwrap();
        let state = server.lock().unwrap();
        Ok(serde_json::json!({
            "contents": [{
                "uri": "info://server",
                "mimeType": "application/json",
                "text": serde_json::to_string_pretty(&serde_json::json!({
                    "name": state.name,
                    "version": state.version,
                    "capabilities": state.capabilities,
                    "tools": state.tools.len(),
                    "resources": state.resources.len(),
                    "prompts": state.prompts.len(),
                })).unwrap()
            }]
        }))
    }
}

struct TimeResource;
impl ResourceHandler for TimeResource {
    fn read(&self, _uri: &str) -> Result<serde_json::Value, JsonRpcError> {
        let now = js_sys::Date::new_0();
        Ok(serde_json::json!({
            "contents": [{
                "uri": "time://now",
                "mimeType": "application/json",
                "text": serde_json::to_string_pretty(&serde_json::json!({
                    "iso": now.to_iso_string().as_string().unwrap(),
                    "timestamp": now.get_time(),
                    "timezone": now.get_timezone_offset(),
                })).unwrap()
            }]
        }))
    }
}

// ============================================
// BUILT-IN PROMPTS
// ============================================

struct AssistantPrompt;
impl PromptHandler for AssistantPrompt {
    fn render(&self, args: serde_json::Value) -> Result<serde_json::Value, JsonRpcError> {
        let task = args.get("task").and_then(|v| v.as_str()).unwrap_or("general assistance");
        Ok(serde_json::json!({
            "messages": [
                {"role": "system", "content": "You are a helpful assistant running in WebAssembly."},
                {"role": "user", "content": format!("Help with: {}", task)}
            ]
        }))
    }
}

// ============================================
// WASM EXPORTS
// ============================================

#[wasm_bindgen]
pub fn initialize_server(name: &str, version: &str) -> Result<(), JsValue> {
    console_error_panic_hook::set_once();

    let mut state = ServerState::new(name, version);

    // Register built-in tools
    state.add_tool(Tool {
        name: "echo".to_string(),
        description: "Echo message back".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "message": {"type": "string"},
                "count": {"type": "integer", "minimum": 1, "default": 1}
            },
            "required": ["message"]
        }),
        output_schema: None,
    }, Box::new(EchoTool));

    state.add_tool(Tool {
        name: "hash".to_string(),
        description: "SHA256 hash".to_string(),
        input_schema: serde_json::json!({
            "type": "object",
            "properties": {
                "input": {"type": "string"}
            },
            "required": ["input"]
        }),
        output_schema: None,
    }, Box::new(HashTool));

    state.add_tool(Tool {
        name: "uuid".to_string(),
        description: "Generate UUID".to_string(),
        input_schema: serde_json::json!({"type": "object", "properties": {}}),
        output_schema: None,
    }, Box::new(UuidTool));

    state.add_tool(Tool {
        name: "health".to_string(),
        description: "Health check".to_string(),
        input_schema: serde_json::json!({"type": "object", "properties": {}}),
        output_schema: None,
    }, Box::new(HealthTool));

    // Register resources
    state.add_resource(Resource {
        uri: "info://server".to_string(),
        name: "Server Info".to_string(),
        description: Some("Server information and capabilities".to_string()),
        mime_type: Some("application/json".to_string()),
    }, Box::new(InfoResource));

    state.add_resource(Resource {
        uri: "time://now".to_string(),
        name: "Current Time".to_string(),
        description: Some("Current timestamp".to_string()),
        mime_type: Some("application/json".to_string()),
    }, Box::new(TimeResource));

    // Register prompts
    state.add_prompt(Prompt {
        name: "assistant".to_string(),
        description: Some("General assistant prompt".to_string()),
        arguments: vec![PromptArgument {
            name: "task".to_string(),
            description: Some("Task description".to_string()),
            required: true,
        }],
    }, Box::new(AssistantPrompt));

    *SERVER.lock().unwrap() = Some(Arc::new(Mutex::new(state)));
    Ok(())
}

#[wasm_bindgen]
pub fn handle_request(request_json: &str) -> Result<String, JsValue> {
    let request: JsonRpcRequest = serde_json::from_str(request_json)
        .map_err(|e| JsValue::from_str(&format!("Parse error: {}", e)))?;

    let server = SERVER.lock().unwrap();
    let server = server.as_ref().ok_or_else(|| JsValue::from_str("Server not initialized"))?;
    let state = server.lock().unwrap();

    let response = match request.method.as_str() {
        "initialize" => {
            JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                id: request.id,
                result: Some(serde_json::json!({
                    "protocolVersion": "2024-11-05",
                    "capabilities": state.capabilities,
                    "serverInfo": {
                        "name": state.name,
                        "version": state.version
                    }
                })),
                error: None,
            }
        }
        "tools/list" => {
            JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                id: request.id,
                result: Some(serde_json::json!({"tools": state.tools})),
                error: None,
            }
        }
        "tools/call" => {
            let params = request.params.unwrap_or_default();
            let tool_name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or(serde_json::json!({}));

            if let Some(handler) = state.tool_handlers.get(tool_name) {
                match handler.call(args) {
                    Ok(result) => JsonRpcResponse {
                        jsonrpc: "2.0".to_string(),
                        id: request.id,
                        result: Some(result),
                        error: None,
                    },
                    Err(e) => JsonRpcResponse {
                        jsonrpc: "2.0".to_string(),
                        id: request.id,
                        result: None,
                        error: Some(e),
                    }
                }
            } else {
                JsonRpcResponse {
                    jsonrpc: "2.0".to_string(),
                    id: request.id,
                    result: None,
                    error: Some(JsonRpcError { code: -32601, message: format!("Tool not found: {}", tool_name), data: None }),
                }
            }
        }
        "resources/list" => {
            JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                id: request.id,
                result: Some(serde_json::json!({"resources": state.resources})),
                error: None,
            }
        }
        "resources/read" => {
            let params = request.params.unwrap_or_default();
            let uri = params.get("uri").and_then(|v| v.as_str()).unwrap_or("");

            if let Some(handler) = state.resource_handlers.get(uri) {
                match handler.read(uri) {
                    Ok(result) => JsonRpcResponse {
                        jsonrpc: "2.0".to_string(),
                        id: request.id,
                        result: Some(result),
                        error: None,
                    },
                    Err(e) => JsonRpcResponse {
                        jsonrpc: "2.0".to_string(),
                        id: request.id,
                        result: None,
                        error: Some(e),
                    }
                }
            } else {
                JsonRpcResponse {
                    jsonrpc: "2.0".to_string(),
                    id: request.id,
                    result: None,
                    error: Some(JsonRpcError { code: -32601, message: format!("Resource not found: {}", uri), data: None }),
                }
            }
        }
        "prompts/list" => {
            JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                id: request.id,
                result: Some(serde_json::json!({"prompts": state.prompts})),
                error: None,
            }
        }
        "prompts/get" => {
            let params = request.params.unwrap_or_default();
            let prompt_name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or(serde_json::json!({}));

            if let Some(handler) = state.prompt_handlers.get(prompt_name) {
                match handler.render(args) {
                    Ok(result) => JsonRpcResponse {
                        jsonrpc: "2.0".to_string(),
                        id: request.id,
                        result: Some(result),
                        error: None,
                    },
                    Err(e) => JsonRpcResponse {
                        jsonrpc: "2.0".to_string(),
                        id: request.id,
                        result: None,
                        error: Some(e),
                    }
                }
            } else {
                JsonRpcResponse {
                    jsonrpc: "2.0".to_string(),
                    id: request.id,
                    result: None,
                    error: Some(JsonRpcError { code: -32601, message: format!("Prompt not found: {}", prompt_name), data: None }),
                }
            }
        }
        _ => JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id: request.id,
            result: None,
            error: Some(JsonRpcError { code: -32601, message: format!("Method not found: {}", request.method), data: None }),
        }
    };

    serde_json::to_string(&response)
        .map_err(|e| JsValue::from_str(&format!("Serialize error: {}", e)))
}

#[wasm_bindgen]
pub fn get_capabilities() -> Result<String, JsValue> {
    let server = SERVER.lock().unwrap();
    let server = server.as_ref().ok_or_else(|| JsValue::from_str("Server not initialized"))?;
    let state = server.lock().unwrap();

    serde_json::to_string(&state.capabilities)
        .map_err(|e| JsValue::from_str(&format!("Serialize error: {}", e)))
}

// ============================================
// TESTS
// ============================================

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    fn test_initialize() {
        initialize_server("test-server", "1.0.0").unwrap();
        let caps = get_capabilities().unwrap();
        assert!(caps.contains("tools"));
    }

    #[wasm_bindgen_test]
    fn test_echo_tool() {
        initialize_server("test", "1.0.0").unwrap();
        let request = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"echo","arguments":{"message":"hello","count":2}}}"#;
        let response = handle_request(request).unwrap();
        assert!(response.contains("hellohello"));
    }

    #[wasm_bindgen_test]
    fn test_hash_tool() {
        initialize_server("test", "1.0.0").unwrap();
        let request = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"hash","arguments":{"input":"test"}}}"#;
        let response = handle_request(request).unwrap();
        assert!(response.contains("9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"));
    }
}
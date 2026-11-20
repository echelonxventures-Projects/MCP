#![no_std]
#![no_main]

//! Embedded MCP Server
//! Runs on microcontrollers with no_std support
//! Supports Serial, USB, and BLE transports

use core::cell::RefCell;
use core::fmt::Write;
use embassy_executor::Spawner;
use embassy_sync::blocking_mutex::raw::CriticalSectionRawMutex;
use embassy_sync::mutex::Mutex;
use embassy_time::{Duration, Timer};
use heapless::{String, Vec};
use mcp_server::{
    McpServer, ToolHandler, ResourceHandler, PromptHandler,
    ToolSchema, ResourceSchema, PromptSchema,
    JsonRpcRequest, JsonRpcResponse, JsonRpcError,
};
use mcp_transport::{Transport, SerialTransport, BleTransport, UsbTransport};
use mcp_types::{Tool, Resource, Prompt, ToolAnnotations, ResourceAnnotations};
use postcard::{to_slice, from_bytes};
use defmt::{info, error, warn};

// ============================================
// EMBEDDED CONFIGURATION
// ============================================

const MAX_TOOLS: usize = 16;
const MAX_RESOURCES: usize = 8;
const MAX_PROMPTS: usize = 4;
const MAX_BUFFER_SIZE: usize = 1024;
const MAX_STRING_SIZE: usize = 256;

type ToolList = Vec<Tool, MAX_TOOLS>;
type ResourceList = Vec<Resource, MAX_RESOURCES>;
type PromptList = Vec<Prompt, MAX_PROMPTS>;
type Buffer = Vec<u8, MAX_BUFFER_SIZE>;
type JsonString = String<MAX_STRING_SIZE>;

// ============================================
// DEVICE STATE
// ============================================

#[derive(Clone, Copy, defmt::Format)]
struct SensorReading {
    temperature: i16,  // 0.01°C units
    humidity: u16,     // 0.01% units
    pressure: u32,     // Pa
    battery_mv: u16,   // mV
    timestamp: u64,    // Unix seconds
}

struct DeviceState {
    device_id: JsonString,
    firmware_version: JsonString,
    sensor_data: SensorReading,
    uptime_seconds: u32,
    error_count: u32,
}

static DEVICE_STATE: Mutex<CriticalSectionRawMutex, RefCell<DeviceState>> = Mutex::new(RefCell::new(DeviceState {
    device_id: String::new(),
    firmware_version: String::new(),
    sensor_data: SensorReading { temperature: 0, humidity: 0, pressure: 0, battery_mv: 0, timestamp: 0 },
    uptime_seconds: 0,
    error_count: 0,
}));

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
    async fn call(&self, args: &[u8], output: &mut Buffer) -> Result<(), JsonRpcError> {
        // Parse input (simplified - in production use proper JSON parsing)
        let input = core::str::from_utf8(args).map_err(|_| JsonRpcError::parse_error())?;

        // Mock response
        let response = JsonRpcResponse {
            jsonrpc: "2.0",
            id: Some(serde_json::Value::Null),
            result: Some(serde_json::json!({"content":[{"type":"text","text":input}]})),
            error: None,
        };

        let bytes = to_slice(&response).map_err(|_| JsonRpcError::internal_error())?;
        output.extend_from_slice(bytes).map_err(|_| JsonRpcError::internal_error())?;
        Ok(())
    }
}

struct SensorReadTool;
impl ToolHandler for SensorReadTool {
    fn name(&self) -> &str { "read_sensors" }
    fn description(&self) -> &str { "Read all sensor values" }
    fn schema(&self) -> ToolSchema {
        ToolSchema {
            name: "read_sensors",
            description: "Read all sensor values",
            input_schema: r#"{"type":"object","properties":{}}"#,
            output_schema: None,
            annotations: None,
        }
    }
    async fn call(&self, _args: &[u8], output: &mut Buffer) -> Result<(), JsonRpcError> {
        let state = DEVICE_STATE.lock().await;
        let state = state.borrow();

        let temp_c = state.sensor_data.temperature as f32 / 100.0;
        let hum_pct = state.sensor_data.humidity as f32 / 100.0;
        let pressure_kpa = state.sensor_data.pressure as f32 / 1000.0;
        let battery_v = state.sensor_data.battery_mv as f32 / 1000.0;

        let response_text = format!(
            "Temperature: {:.2}°C\nHumidity: {:.2}%\nPressure: {:.2} kPa\nBattery: {:.2}V\nUptime: {}s",
            temp_c, hum_pct, pressure_kpa, battery_v, state.uptime_seconds
        );

        let response = JsonRpcResponse {
            jsonrpc: "2.0",
            id: Some(serde_json::Value::Null),
            result: Some(serde_json::json!({"content":[{"type":"text","text":response_text}]})),
            error: None,
        };

        let bytes = to_slice(&response).map_err(|_| JsonRpcError::internal_error())?;
        output.extend_from_slice(bytes).map_err(|_| JsonRpcError::internal_error())?;
        Ok(())
    }
}

struct DeviceInfoTool;
impl ToolHandler for DeviceInfoTool {
    fn name(&self) -> &str { "device_info" }
    fn description(&self) -> &str { "Get device information" }
    fn schema(&self) -> ToolSchema {
        ToolSchema {
            name: "device_info",
            description: "Get device information",
            input_schema: r#"{"type":"object","properties":{}}"#,
            output_schema: None,
            annotations: None,
        }
    }
    async fn call(&self, _args: &[u8], output: &mut Buffer) -> Result<(), JsonRpcError> {
        let state = DEVICE_STATE.lock().await;
        let state = state.borrow();

        let response_text = format!(
            "Device ID: {}\nFirmware: {}\nUptime: {}s\nErrors: {}",
            state.device_id.as_str(),
            state.firmware_version.as_str(),
            state.uptime_seconds,
            state.error_count
        );

        let response = JsonRpcResponse {
            jsonrpc: "2.0",
            id: Some(serde_json::Value::Null),
            result: Some(serde_json::json!({"content":[{"type":"text","text":response_text}]})),
            error: None,
        };

        let bytes = to_slice(&response).map_err(|_| JsonRpcError::internal_error())?;
        output.extend_from_slice(bytes).map_err(|_| JsonRpcError::internal_error())?;
        Ok(())
    }
}

struct RebootTool;
impl ToolHandler for RebootTool {
    fn name(&self) -> &str { "reboot" }
    fn description(&self) -> &str { "Reboot the device" }
    fn schema(&self) -> ToolSchema {
        ToolSchema {
            name: "reboot",
            description: "Reboot the device",
            input_schema: r#"{"type":"object","properties":{"confirm":{"type":"boolean"}},"required":["confirm"]}"#,
            output_schema: None,
            annotations: None,
        }
    }
    async fn call(&self, args: &[u8], output: &mut Buffer) -> Result<(), JsonRpcError> {
        let input = core::str::from_utf8(args).map_err(|_| JsonRpcError::parse_error())?;
        if input.contains("true") {
            // In real implementation: cortex_m::peripheral::SCB::sys_reset()
            let response = JsonRpcResponse {
                jsonrpc: "2.0",
                id: Some(serde_json::Value::Null),
                result: Some(serde_json::json!({"content":[{"type":"text","text":"Rebooting..."}]})),
                error: None,
            };
            let bytes = to_slice(&response).map_err(|_| JsonRpcError::internal_error())?;
            output.extend_from_slice(bytes).map_err(|_| JsonRpcError::internal_error())?;
            // cortex_m::peripheral::SCB::sys_reset();
        } else {
            let response = JsonRpcResponse {
                jsonrpc: "2.0",
                id: Some(serde_json::Value::Null),
                result: Some(serde_json::json!({"content":[{"type":"text","text":"Reboot cancelled. Set confirm=true to proceed."}]})),
                error: None,
            };
            let bytes = to_slice(&response).map_err(|_| JsonRpcError::internal_error())?;
            output.extend_from_slice(bytes).map_err(|_| JsonRpcError::internal_error())?;
        }
        Ok(())
    }
}

// ============================================
// RESOURCE HANDLERS
// ============================================

struct DeviceResource;
impl ResourceHandler for DeviceResource {
    fn uri_pattern(&self) -> &str { "device://{device_id}" }
    fn name(&self) -> &str { "Device Information" }
    fn mime_type(&self) -> &str { "application/json" }
    fn schema(&self) -> ResourceSchema {
        ResourceSchema {
            uri_pattern: "device://{device_id}",
            name: "Device Information",
            description: "Current device state and sensor readings",
            mime_type: "application/json",
            annotations: None,
        }
    }
    async fn read(&self, _uri: &str, output: &mut Buffer) -> Result<(), JsonRpcError> {
        let state = DEVICE_STATE.lock().await;
        let state = state.borrow();

        let json = format!(
            r#"{{"device_id":"{}","firmware":"{}","temperature":{},"humidity":{},"pressure":{},"battery_mv":{},"uptime_s":{},"errors":{}}}"#,
            state.device_id.as_str(),
            state.firmware_version.as_str(),
            state.sensor_data.temperature,
            state.sensor_data.humidity,
            state.sensor_data.pressure,
            state.sensor_data.battery_mv,
            state.uptime_seconds,
            state.error_count
        );

        output.extend_from_slice(json.as_bytes()).map_err(|_| JsonRpcError::internal_error())?;
        Ok(())
    }
}

struct SensorsResource;
impl ResourceHandler for SensorsResource {
    fn uri_pattern(&self) -> &str { "device://{device_id}/sensors" }
    fn name(&self) -> &str { "Sensor Readings" }
    fn mime_type(&self) -> &str { "application/json" }
    fn schema(&self) -> ResourceSchema {
        ResourceSchema {
            uri_pattern: "device://{device_id}/sensors",
            name: "Sensor Readings",
            description: "Latest sensor readings in JSON",
            mime_type: "application/json",
            annotations: None,
        }
    }
    async fn read(&self, _uri: &str, output: &mut Buffer) -> Result<(), JsonRpcError> {
        let state = DEVICE_STATE.lock().await;
        let state = state.borrow();

        let json = format!(
            r#"{{"temperature_c":{},"humidity_pct":{},"pressure_pa":{},"battery_mv":{},"timestamp":{}}}"#,
            state.sensor_data.temperature,
            state.sensor_data.humidity,
            state.sensor_data.pressure,
            state.sensor_data.battery_mv,
            state.sensor_data.timestamp
        );

        output.extend_from_slice(json.as_bytes()).map_err(|_| JsonRpcError::internal_error())?;
        Ok(())
    }
}

// ============================================
// PROMPT HANDLERS
// ============================================

struct DiagnosticsPrompt;
impl PromptHandler for DiagnosticsPrompt {
    fn name(&self) -> &str { "diagnostics" }
    fn description(&self) -> &str { "Run device diagnostics" }
    fn schema(&self) -> PromptSchema {
        PromptSchema {
            name: "diagnostics",
            description: "Run device diagnostics",
            arguments: r#"[{"name":"include_sensors","type":"boolean","default":true}]"#,
        }
    }
    async fn render(&self, args: &[u8], output: &mut Buffer) -> Result<(), JsonRpcError> {
        let prompt = "You are an embedded systems engineer. Analyze the device sensor data and provide diagnostics:\n\
            - Check if readings are within expected ranges\n\
            - Identify any anomalies or sensor drift\n\
            - Assess battery health\n\
            - Recommend maintenance actions";

        output.extend_from_slice(prompt.as_bytes()).map_err(|_| JsonRpcError::internal_error())?;
        Ok(())
    }
}

// ============================================
// SENSOR SIMULATION TASK
// ============================================

#[embassy_executor::task]
async fn sensor_simulation() {
    let mut counter: u32 = 0;
    loop {
        Timer::after(Duration::from_secs(10)).await;

        let mut state = DEVICE_STATE.lock().await;
        let state = state.borrow_mut();

        // Simulate sensor readings
        state.sensor_data.temperature = 2000 + (counter as i16 * 5) % 1000;  // 20-30°C
        state.sensor_data.humidity = 4000 + (counter as u16 * 7) % 2000;    // 40-60%
        state.sensor_data.pressure = 101325 + (counter as u32 * 11) % 5000; // ~101 kPa
        state.sensor_data.battery_mv = 4200 - (counter as u16 / 100) % 200; // Slowly draining
        state.sensor_data.timestamp = counter as u64;
        state.uptime_seconds = counter;

        counter += 10;
    }
}

// ============================================
// MAIN
// ============================================

#[embassy_executor::main]
async fn main(spawner: Spawner) {
    // Initialize device state
    {
        let mut state = DEVICE_STATE.lock().await;
        let state = state.borrow_mut();
        state.device_id.push_str("sensor-node-001").ok();
        state.firmware_version.push_str("1.0.0").ok();
    }

    info!("Starting embedded MCP server...");

    // Spawn sensor simulation
    spawner.spawn(sensor_simulation()).unwrap();

    // Create server with tools, resources, prompts
    let server = McpServer::new(
        "embedded-sensor",
        "1.0.0",
        vec![
            Box::new(EchoTool),
            Box::new(SensorReadTool),
            Box::new(DeviceInfoTool),
            Box::new(RebootTool),
        ],
        vec![
            Box::new(DeviceResource),
            Box::new(SensorsResource),
        ],
        vec![
            Box::new(DiagnosticsPrompt),
        ],
    );

    // Initialize transport (choose one based on hardware)
    // Option 1: Serial (UART)
    #[cfg(feature = "serial")]
    let transport = SerialTransport::new(/* UART peripheral */);

    // Option 2: USB CDC
    #[cfg(feature = "usb")]
    let transport = UsbTransport::new(/* USB peripheral */);

    // Option 3: Bluetooth LE
    #[cfg(feature = "ble")]
    let transport = BleTransport::new(/* BLE peripheral */);

    // Run server loop
    loop {
        match transport.receive().await {
            Ok(request_bytes) => {
                let mut response_buffer = Buffer::new();
                if let Err(e) = server.handle_request(&request_bytes, &mut response_buffer).await {
                    error!("Request handling error: {:?}", e);
                    let mut state = DEVICE_STATE.lock().await;
                    state.borrow_mut().error_count += 1;
                }

                if let Err(e) = transport.send(&response_buffer).await {
                    error!("Send error: {:?}", e);
                }
            }
            Err(e) => {
                error!("Receive error: {:?}", e);
                Timer::after(Duration::from_millis(100)).await;
            }
        }
    }
}

// Panic handler
#[panic_handler]
fn panic(info: &core::panic::PanicInfo) -> ! {
    defmt::error!("PANIC: {}", defmt::Debug2Format(info));
    loop {
        cortex_m::asm::bkpt();
    }
}
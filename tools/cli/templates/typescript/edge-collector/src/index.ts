/**
 * Edge Collector MCP Server
 * Lightweight data collection at the edge with intermittent connectivity support
 */

import { McpServer, tool, resource, prompt } from "@mcp/server";
import { z } from "zod";

// Type definitions
type EdgeDeviceType = "sensor" | "gateway" | "mobile" | "iot" | "vehicle" | "drone";
type ConnectionState = "online" | "offline" | "syncing" | "reconnecting";

interface EdgeDevice {
  id: string;
  name: string;
  type: EdgeDeviceType;
  location?: { lat: number; lng: number; altitude?: number };
  metadata?: Record<string, unknown>;
  firmwareVersion: string;
  lastSeen: string;
  connectionState: ConnectionState;
  capabilities: string[];
}

interface TelemetryData {
  deviceId: string;
  timestamp: string;
  metrics: Record<string, number>;
  tags?: Record<string, string>;
  location?: { lat: number; lng: number };
}

interface SyncJob {
  id: string;
  deviceId: string;
  status: "pending" | "running" | "completed" | "failed";
  dataPoints: number;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

// In-memory stores (in production: use local DB like SQLite/BadgerDB)
const devices: Map<string, EdgeDevice> = new Map();
const telemetryBuffer: TelemetryData[] = [];
const syncJobs: Map<string, SyncJob> = new Map();
const MAX_BUFFER_SIZE = 10000;

// Initialize sample edge device
function initializeSampleData() {
  const device: EdgeDevice = {
    id: "edge-001",
    name: "Warehouse Sensor Gateway",
    type: "gateway",
    location: { lat: 37.7749, lng: -122.4194 },
    firmwareVersion: "2.1.0",
    lastSeen: new Date().toISOString(),
    connectionState: "online",
    capabilities: ["temperature", "humidity", "pressure", "motion", "battery"],
    metadata: { building: "A", floor: 2 },
  };
  devices.set(device.id, device);
}

initializeSampleData();

// Mock data ingestion
async function ingestTelemetry(data: TelemetryData): Promise<void> {
  telemetryBuffer.push(data);
  if (telemetryBuffer.length > MAX_BUFFER_SIZE) {
    telemetryBuffer.shift(); // FIFO eviction
  }

  const device = devices.get(data.deviceId);
  if (device) {
    device.lastSeen = data.timestamp;
    device.connectionState = "online";
    devices.set(device.id, device);
  }
}

// Create MCP server
const server = new McpServer({
  name: "edge-collector",
  version: "1.0.0",
  capabilities: {
    tools: { listChanged: true },
    resources: { subscribe: true, listChanged: true },
    prompts: { listChanged: true },
    logging: {},
  },
});

// ============================================
// TOOLS
// ============================================

server.tool("register-device", "Register edge device", {
  name: z.string(),
  type: z.enum(["sensor", "gateway", "mobile", "iot", "vehicle", "drone"]),
  location: z.object({ lat: z.number(), lng: z.number(), altitude: z.number().optional() }).optional(),
  metadata: z.record(z.unknown()).optional(),
  firmwareVersion: z.string(),
  capabilities: z.array(z.string()),
}, async ({ name, type, location, metadata, firmwareVersion, capabilities }) => {
  const id = `edge-${Date.now()}`;
  const device: EdgeDevice = {
    id,
    name,
    type,
    location,
    metadata,
    firmwareVersion,
    lastSeen: new Date().toISOString(),
    connectionState: "online",
    capabilities,
  };
  devices.set(id, device);
  return { content: [{ type: "text", text: JSON.stringify(device, null, 2) }] });
});

server.tool("list-devices", "List edge devices", {
  type: z.enum(["sensor", "gateway", "mobile", "iot", "vehicle", "drone"]).optional(),
  state: z.enum(["online", "offline", "syncing", "reconnecting"]).optional(),
}, async ({ type, state }) => {
  let result = Array.from(devices.values());
  if (type) result = result.filter(d => d.type === type);
  if (state) result = result.filter(d => d.connectionState === state);
  return { content: [{ type: "text", text: JSON.stringify({ devices: result }, null, 2) }] });
});

server.tool("get-device", "Get device details", {
  deviceId: z.string(),
}, async ({ deviceId }) => {
  const device = devices.get(deviceId);
  if (!device) return { content: [{ type: "text", text: JSON.stringify({ error: "Not found" }) }], isError: true };
  return { content: [{ type: "text", text: JSON.stringify(device, null, 2) }] });
});

server.tool("ingest-telemetry", "Ingest telemetry data", {
  deviceId: z.string(),
  metrics: z.record(z.number()),
  tags: z.record(z.string()).optional(),
  location: z.object({ lat: z.number(), lng: z.number() }).optional(),
  timestamp: z.string().optional(),
}, async ({ deviceId, metrics, tags, location, timestamp }) => {
  const device = devices.get(deviceId);
  if (!device) return { content: [{ type: "text", text: JSON.stringify({ error: "Device not found" }) }], isError: true };

  const data: TelemetryData = {
    deviceId,
    timestamp: timestamp || new Date().toISOString(),
    metrics,
    tags,
    location,
  };

  await ingestTelemetry(data);

  return { content: [{ type: "text", text: JSON.stringify({ success: true, bufferSize: telemetryBuffer.length }, null, 2) }] });
});

server.tool("batch-ingest", "Batch ingest telemetry", {
  dataPoints: z.array(z.object({
    deviceId: z.string(),
    metrics: z.record(z.number()),
    tags: z.record(z.string()).optional(),
    location: z.object({ lat: z.number(), lng: z.number() }).optional(),
    timestamp: z.string().optional(),
  })),
}, async ({ dataPoints }) => {
  let success = 0, failed = 0;
  for (const dp of dataPoints) {
    const device = devices.get(dp.deviceId);
    if (!device) { failed++; continue; }
    await ingestTelemetry({ ...dp, timestamp: dp.timestamp || new Date().toISOString() });
    success++;
  }
  return { content: [{ type: "text", text: JSON.stringify({ success, failed, bufferSize: telemetryBuffer.length }, null, 2) }] });
});

server.tool("query-telemetry", "Query buffered telemetry", {
  deviceId: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  metrics: z.array(z.string()).optional(),
  limit: z.number().default(100),
}, async ({ deviceId, startTime, endTime, metrics, limit = 100 }) => {
  let results = telemetryBuffer;

  if (deviceId) results = results.filter(d => d.deviceId === deviceId);
  if (startTime) results = results.filter(d => d.timestamp >= startTime);
  if (endTime) results = results.filter(d => d.timestamp <= endTime);
  if (metrics) {
    results = results.filter(d => metrics.some(m => m in d.metrics));
  }

  results = results.slice(-limit).reverse();

  return { content: [{ type: "text", text: JSON.stringify({ count: results.length, data: results }, null, 2) }] });
});

server.tool("start-sync", "Start data sync to cloud", {
  deviceId: z.string(),
  destination: z.string().describe("Cloud endpoint URL"),
}, async ({ deviceId, destination }) => {
  const device = devices.get(deviceId);
  if (!device) return { content: [{ type: "text", text: JSON.stringify({ error: "Device not found" }) }], isError: true };

  const deviceData = telemetryBuffer.filter(d => d.deviceId === deviceId);
  const id = `sync-${Date.now()}`;
  const job: SyncJob = {
    id,
    deviceId,
    status: "running",
    dataPoints: deviceData.length,
    startedAt: new Date().toISOString(),
  };
  syncJobs.set(id, job);

  device.connectionState = "syncing";
  devices.set(device.id, device);

  // Simulate async sync
  setTimeout(() => {
    job.status = "completed";
    job.completedAt = new Date().toISOString();
    device.connectionState = "online";
    devices.set(device.id, device);
  }, 2000);

  return { content: [{ type: "text", text: JSON.stringify(job, null, 2) }] });
});

server.tool("get-sync-status", "Get sync job status", {
  jobId: z.string(),
}, async ({ jobId }) => {
  const job = syncJobs.get(jobId);
  if (!job) return { content: [{ type: "text", text: JSON.stringify({ error: "Not found" }) }], isError: true };
  return { content: [{ type: "text", text: JSON.stringify(job, null, 2) }] });
});

server.tool("update-firmware", "Trigger firmware update", {
  deviceId: z.string(),
  version: z.string(),
  url: z.string().url(),
}, async ({ deviceId, version, url }) => {
  const device = devices.get(deviceId);
  if (!device) return { content: [{ type: "text", text: JSON.stringify({ error: "Device not found" }) }], isError: true };

  device.firmwareVersion = version;
  device.connectionState = "reconnecting";
  devices.set(device.id, device);

  // Simulate update
  setTimeout(() => {
    device.connectionState = "online";
    devices.set(device.id, device);
  }, 5000);

  return { content: [{ type: "text", text: JSON.stringify({ success: true, deviceId, newVersion: version }, null, 2) }] });
});

// ============================================
// RESOURCES
// ============================================

server.resource("device://{deviceId}", "Device details", async (uri) => {
  const device = devices.get(uri.params.deviceId);
  if (!device) throw new Error(`Not found: ${uri.params.deviceId}`);
  return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(device, null, 2) }] });
});

server.resource("telemetry://{deviceId}/latest", "Latest telemetry", async (uri) => {
  const data = telemetryBuffer
    .filter(d => d.deviceId === uri.params.deviceId)
    .slice(-10)
    .reverse();
  return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ data }, null, 2) }] });
});

server.resource("sync://{jobId}", "Sync job status", async (uri) => {
  const job = syncJobs.get(uri.params.jobId);
  if (!job) throw new Error(`Not found: ${uri.params.jobId}`);
  return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(job, null, 2) }] });
});

server.resource("buffer://status", "Buffer status", async () => ({
  contents: [{
    uri: "buffer://status",
    mimeType: "application/json",
    text: JSON.stringify({
      totalPoints: telemetryBuffer.length,
      maxSize: MAX_BUFFER_SIZE,
      utilizationPercent: (telemetryBuffer.length / MAX_BUFFER_SIZE * 100).toFixed(1),
      devicesOnline: Array.from(devices.values()).filter(d => d.connectionState === "online").length,
    }, null, 2)
  }]
}));

// ============================================
// PROMPTS
// ============================================

server.prompt("analyze-device-health", "Analyze device health", {
  deviceId: z.string(),
}, ({ deviceId }) => ({
  messages: [
    { role: "system", content: "IoT engineer. Analyze device telemetry for anomalies." },
    { role: "user", content: `Analyze device ${deviceId}. Check: battery trends, sensor drift, connectivity gaps, firmware status. Provide recommendations.` }
  ]
}));

server.prompt("optimize-collection", "Optimize data collection", {
  deviceType: z.string(),
  constraints: z.string().describe("Power, bandwidth, storage constraints"),
}, ({ deviceType, constraints }) => ({
  messages: [
    { role: "system", content: "Edge computing architect. Optimize collection strategy." },
    { role: "user", content: `Device type: ${deviceType}\nConstraints: ${constraints}\nRecommend: sampling rates, batch sizes, compression, sync intervals.` }
  ]
}));

// ============================================
// HEALTH
// ============================================

server.tool("health", "Health check", {}, async () => ({
  content: [{ type: "text", text: JSON.stringify({
    status: "healthy",
    timestamp: new Date().toISOString(),
    devices: devices.size,
    online: Array.from(devices.values()).filter(d => d.connectionState === "online").length,
    bufferSize: telemetryBuffer.length,
    bufferUtilization: (telemetryBuffer.length / MAX_BUFFER_SIZE * 100).toFixed(1) + "%",
    pendingSyncs: Array.from(syncJobs.values()).filter(j => j.status === "running").length,
  }, null, 2) }]
}));

// Start server
async function main() {
  const transport = process.env.MCP_TRANSPORT || "websocket";
  const port = parseInt(process.env.MCP_PORT || "3000", 10);
  const host = process.env.MCP_HOST || "0.0.0.0";

  console.error(`Starting edge-collector on ${transport}...`);

  if (transport === "websocket") await server.start({ transport: "websocket", port, host });
  else if (transport === "http-sse") await server.start({ transport: "http-sse", port, host });
  else if (transport === "grpc") await server.start({ transport: "grpc", port, host });
  else await server.start({ transport: "stdio" });

  console.error("Edge collector server started");
}

main().catch((e) => { console.error("Failed:", e); process.exit(1); });
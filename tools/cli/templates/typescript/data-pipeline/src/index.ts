/**
 * Data Pipeline MCP Server
 * ETL pipelines, data sources, transformations, and pipeline orchestration
 */

import { McpServer, tool, resource, prompt } from "@mcp/server";
import { z } from "zod";

// Type definitions
type SourceType = "database" | "api" | "file" | "stream" | "warehouse";
type PipelineStatus = "draft" | "active" | "paused" | "running" | "completed" | "failed";
type RunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

interface DataSource {
  id: string;
  name: string;
  type: SourceType;
  config: Record<string, unknown>;
  schema?: Record<string, unknown>;
  description: string;
  isActive: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface Transformation {
  id: string;
  name: string;
  description: string;
  sql: string;
  python: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface Pipeline {
  id: string;
  name: string;
  description: string;
  sourceIds: string[];
  transformationIds: string[];
  destinationId: string;
  schedule?: string;
  status: PipelineStatus;
  config: Record<string, unknown>;
  tags: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface PipelineRun {
  id: string;
  pipelineId: string;
  status: RunStatus;
  triggeredBy: string;
  parameters: Record<string, unknown>;
  startTime?: string;
  endTime?: string;
  rowsProcessed: number;
  bytesProcessed: number;
  error: string;
  logs: string[];
  createdAt: string;
}

interface DataQualityCheck {
  id: string;
  name: string;
  description: string;
  pipelineId: string;
  checkType: string;
  config: Record<string, unknown>;
  threshold: number;
  severity: "info" | "warning" | "critical";
  isActive: boolean;
}

// In-memory stores
const dataSources: Map<string, DataSource> = new Map();
const transformations: Map<string, Transformation> = new Map();
const pipelines: Map<string, Pipeline> = new Map();
const pipelineRuns: Map<string, PipelineRun> = new Map();
const qualityChecks: Map<string, DataQualityCheck> = new Map();

// Initialize sample data
function initializeSampleData() {
  const ds1: DataSource = {
    id: "src-001",
    name: "Production PostgreSQL",
    type: "database",
    config: { host: "prod-db", port: 5432, database: "app", schema: "public" },
    description: "Main application database",
    isActive: true,
    tags: ["production", "postgres"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const ds2: DataSource = {
    id: "src-002",
    name: "Events Kafka",
    type: "stream",
    config: { bootstrap_servers: "kafka:9092", topic: "events", group_id: "etl" },
    description: "Real-time event stream",
    isActive: true,
    tags: ["streaming", "kafka"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const ds3: DataSource = {
    id: "src-003",
    name: "Analytics Warehouse",
    type: "warehouse",
    config: { host: "warehouse", port: 5432, database: "analytics", schema: "public" },
    description: "Analytical data warehouse",
    isActive: true,
    tags: ["warehouse", "analytics"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  dataSources.set(ds1.id, ds1);
  dataSources.set(ds2.id, ds2);
  dataSources.set(ds3.id, ds3);

  const t1: Transformation = {
    id: "txn-001",
    name: "Clean User Events",
    description: "Filter and normalize user events",
    sql: `SELECT event_id, user_id, event_type, TO_TIMESTAMP(event_ts) as event_time, JSON_EXTRACT_PATH_TEXT(properties, 'page') as page, JSON_EXTRACT_PATH_TEXT(properties, 'action') as action FROM raw_events WHERE event_ts IS NOT NULL AND user_id IS NOT NULL`,
    python: "",
    inputSchema: { event_id: "string", user_id: "string", event_type: "string", event_ts: "bigint", properties: "json" },
    outputSchema: { event_id: "string", user_id: "string", event_type: "string", event_time: "timestamp", page: "string", action: "string" },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const t2: Transformation = {
    id: "txn-002",
    name: "Aggregate Daily Metrics",
    description: "Compute daily aggregates from cleaned events",
    sql: `SELECT DATE(event_time) as date, COUNT(DISTINCT user_id) as dau, COUNT(*) as total_events, COUNT(DISTINCT CASE WHEN event_type = 'purchase' THEN user_id END) as purchasers, SUM(CASE WHEN event_type = 'purchase' THEN 1 ELSE 0 END) as purchases FROM cleaned_events GROUP BY 1`,
    python: "",
    inputSchema: { event_time: "timestamp", user_id: "string", event_type: "string" },
    outputSchema: { date: "date", dau: "bigint", total_events: "bigint", purchasers: "bigint", purchases: "bigint" },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  transformations.set(t1.id, t1);
  transformations.set(t2.id, t2);

  const p1: Pipeline = {
    id: "pipe-001",
    name: "Daily User Metrics",
    description: "Compute daily user engagement metrics",
    sourceIds: ["src-002"],
    transformationIds: ["txn-001", "txn-002"],
    destinationId: "src-003",
    schedule: "0 2 * * *",
    status: "active",
    config: {},
    tags: ["daily", "metrics", "user"],
    createdBy: "system",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  pipelines.set(p1.id, p1);
}

initializeSampleData();

// Mock pipeline execution
async function executePipelineMock(pipeline: Pipeline, parameters: Record<string, unknown>): Promise<PipelineRun> {
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const run: PipelineRun = {
    id: runId,
    pipelineId: pipeline.id,
    status: "running",
    triggeredBy: "manual",
    parameters,
    startTime: new Date().toISOString(),
    rowsProcessed: 0,
    bytesProcessed: 0,
    error: "",
    logs: [],
    createdAt: new Date().toISOString(),
  };
  pipelineRuns.set(runId, run);

  const steps = [
    "Extracting from sources...",
    "Applying transformations...",
    "Running quality checks...",
    "Loading to destination...",
  ];

  for (let i = 0; i < steps.length; i++) {
    await new Promise(r => setTimeout(r, 300));
    run.logs.push(`[${new Date().toISOString()}] ${steps[i]}`);
    if (i === 2) {
      run.rowsProcessed = 100000 + (i * 5000);
      run.bytesProcessed = 50 * 1024 * 1024;
    }
  }

  run.status = "completed";
  run.endTime = new Date().toISOString();
  run.rowsProcessed = 125000;
  run.bytesProcessed = 62 * 1024 * 1024;

  return run;
}

// Create MCP server
const server = new McpServer({
  name: "data-pipeline",
  version: "1.0.0",
  capabilities: {
    tools: { listChanged: true },
    resources: { subscribe: true, listChanged: true },
    prompts: { listChanged: true },
    logging: {},
  },
});

// ============================================
// TOOLS - DATA SOURCES
// ============================================

server.tool("register-data-source", "Register a data source", {
  name: z.string(),
  type: z.enum(["database", "api", "file", "stream", "warehouse"]),
  config: z.record(z.unknown()),
  description: z.string().optional(),
  schema: z.record(z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
}, async ({ name, type, config, description, schema, tags }) => {
  const dsId = `src-${Date.now().toString(36)}`;
  const ds: DataSource = {
    id: dsId,
    name,
    type,
    config,
    description: description || "",
    schema,
    isActive: true,
    tags: tags || [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  dataSources.set(dsId, ds);
  return { content: [{ type: "text", text: JSON.stringify(ds, null, 2) }] });
});

server.tool("list-data-sources", "List data sources", {
  type: z.enum(["database", "api", "file", "stream", "warehouse"]).optional(),
  activeOnly: z.boolean().default(true),
}, async ({ type, activeOnly = true }) => {
  let result = Array.from(dataSources.values());
  if (activeOnly) result = result.filter(ds => ds.isActive);
  if (type) result = result.filter(ds => ds.type === type);
  return { content: [{ type: "text", text: JSON.stringify({ dataSources: result, count: result.length }, null, 2) }] });
});

server.tool("get-data-source", "Get data source", {
  dataSourceId: z.string(),
}, async ({ dataSourceId }) => {
  const ds = dataSources.get(dataSourceId);
  if (!ds) return { content: [{ type: "text", text: JSON.stringify({ error: "Data source not found", dataSourceId }) }], isError: true };
  return { content: [{ type: "text", text: JSON.stringify(ds, null, 2) }] });
});

server.tool("test-data-source", "Test data source connection", {
  dataSourceId: z.string(),
}, async ({ dataSourceId }) => {
  const ds = dataSources.get(dataSourceId);
  if (!ds) return { content: [{ type: "text", text: JSON.stringify({ error: "Data source not found", dataSourceId }) }], isError: true };
  await new Promise(r => setTimeout(r, 200));
  return { content: [{ type: "text", text: JSON.stringify({ success: true, message: `Connected to ${ds.type} successfully`, latencyMs: 35 }, null, 2) }] });
});

server.tool("preview-data-source", "Preview data from source", {
  dataSourceId: z.string(),
  limit: z.number().default(10),
}, async ({ dataSourceId, limit = 10 }) => {
  const ds = dataSources.get(dataSourceId);
  if (!ds) return { content: [{ type: "text", text: JSON.stringify({ error: "Data source not found", dataSourceId }) }], isError: true };
  return { content: [{ type: "text", text: JSON.stringify({
    dataSource: ds.name,
    columns: ["id", "name", "created_at", "status"],
    rows: Array.from({ length: limit }, (_, i) => [i + 1, `record_${i + 1}`, new Date().toISOString(), "active"]),
    rowCount: limit,
  }, null, 2) }] });
});

// ============================================
// TOOLS - TRANSFORMATIONS
// ============================================

server.tool("create-transformation", "Create a transformation", {
  name: z.string(),
  description: z.string(),
  sql: z.string().optional(),
  python: z.string().optional(),
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
}, async ({ name, description, sql, python, inputSchema, outputSchema }) => {
  const txnId = `txn-${Date.now().toString(36)}`;
  const txn: Transformation = {
    id: txnId,
    name,
    description,
    sql: sql || "",
    python: python || "",
    inputSchema: inputSchema || {},
    outputSchema: outputSchema || {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  transformations.set(txnId, txn);
  return { content: [{ type: "text", text: JSON.stringify(txn, null, 2) }] });
});

server.tool("list-transformations", "List transformations", {}, async () => ({
  content: [{ type: "text", text: JSON.stringify({ transformations: Array.from(transformations.values()), count: transformations.size }, null, 2) }]
}));

server.tool("get-transformation", "Get transformation", {
  transformationId: z.string(),
}, async ({ transformationId }) => {
  const txn = transformations.get(transformationId);
  if (!txn) return { content: [{ type: "text", text: JSON.stringify({ error: "Transformation not found", transformationId }) }], isError: true };
  return { content: [{ type: "text", text: JSON.stringify(txn, null, 2) }] });
});

// ============================================
// TOOLS - PIPELINES
// ============================================

server.tool("create-pipeline", "Create a pipeline", {
  name: z.string(),
  description: z.string(),
  sourceIds: z.array(z.string()),
  transformationIds: z.array(z.string()),
  destinationId: z.string(),
  schedule: z.string().optional(),
  config: z.record(z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
}, async ({ name, description, sourceIds, transformationIds, destinationId, schedule, config, tags }) => {
  for (const sid of sourceIds) if (!dataSources.has(sid)) return { content: [{ type: "text", text: JSON.stringify({ error: `Source not found: ${sid}` }) }], isError: true };
  for (const tid of transformationIds) if (!transformations.has(tid)) return { content: [{ type: "text", text: JSON.stringify({ error: `Transformation not found: ${tid}` }) }], isError: true };
  if (!dataSources.has(destinationId)) return { content: [{ type: "text", text: JSON.stringify({ error: `Destination not found: ${destinationId}` }) }], isError: true };

  const pipeId = `pipe-${Date.now().toString(36)}`;
  const pipeline: Pipeline = {
    id: pipeId,
    name,
    description,
    sourceIds,
    transformationIds,
    destinationId,
    schedule,
    status: "draft",
    config: config || {},
    tags: tags || [],
    createdBy: "system",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  pipelines.set(pipeId, pipeline);
  return { content: [{ type: "text", text: JSON.stringify(pipeline, null, 2) }] });
});

server.tool("list-pipelines", "List pipelines", {
  status: z.enum(["draft", "active", "paused", "running", "completed", "failed"]).optional(),
  tags: z.array(z.string()).optional(),
}, async ({ status, tags }) => {
  let result = Array.from(pipelines.values());
  if (status) result = result.filter(p => p.status === status);
  if (tags) result = result.filter(p => tags.some(t => p.tags.includes(t)));
  return { content: [{ type: "text", text: JSON.stringify({ pipelines: result, count: result.length }, null, 2) }] });
});

server.tool("get-pipeline", "Get pipeline", {
  pipelineId: z.string(),
}, async ({ pipelineId }) => {
  const pipeline = pipelines.get(pipelineId);
  if (!pipeline) return { content: [{ type: "text", text: JSON.stringify({ error: "Pipeline not found", pipelineId }) }], isError: true };
  return { content: [{ type: "text", text: JSON.stringify(pipeline, null, 2) }] });
});

server.tool("update-pipeline-status", "Update pipeline status", {
  pipelineId: z.string(),
  status: z.enum(["draft", "active", "paused", "running", "completed", "failed"]),
}, async ({ pipelineId, status }) => {
  const pipeline = pipelines.get(pipelineId);
  if (!pipeline) return { content: [{ type: "text", text: JSON.stringify({ error: "Pipeline not found", pipelineId }) }], isError: true };
  pipeline.status = status;
  pipeline.updatedAt = new Date().toISOString();
  return { content: [{ type: "text", text: JSON.stringify(pipeline, null, 2) }] });
});

server.tool("run-pipeline", "Execute a pipeline", {
  pipelineId: z.string(),
  parameters: z.record(z.unknown()).optional(),
}, async ({ pipelineId, parameters }) => {
  const pipeline = pipelines.get(pipelineId);
  if (!pipeline) return { content: [{ type: "text", text: JSON.stringify({ error: "Pipeline not found", pipelineId }) }], isError: true };
  if (pipeline.status !== "active") return { content: [{ type: "text", text: JSON.stringify({ error: `Pipeline is not active (status: ${pipeline.status})` }) }], isError: true };

  const run = await executePipelineMock(pipeline, parameters || {});
  pipelineRuns.set(run.id, run);
  return { content: [{ type: "text", text: JSON.stringify(run, null, 2) }] });
});

server.tool("get-pipeline-run", "Get pipeline run", {
  runId: z.string(),
}, async ({ runId }) => {
  const run = pipelineRuns.get(runId);
  if (!run) return { content: [{ type: "text", text: JSON.stringify({ error: "Run not found", runId }) }], isError: true };
  return { content: [{ type: "text", text: JSON.stringify(run, null, 2) }] });
});

server.tool("list-pipeline-runs", "List pipeline runs", {
  pipelineId: z.string().optional(),
  status: z.enum(["pending", "running", "completed", "failed", "cancelled"]).optional(),
  limit: z.number().default(50),
}, async ({ pipelineId, status, limit = 50 }) => {
  let result = Array.from(pipelineRuns.values());
  if (pipelineId) result = result.filter(r => r.pipelineId === pipelineId);
  if (status) result = result.filter(r => r.status === status);
  result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return { content: [{ type: "text", text: JSON.stringify({ runs: result.slice(0, limit), total: result.length }, null, 2) }] });
});

server.tool("cancel-pipeline-run", "Cancel pipeline run", {
  runId: z.string(),
}, async ({ runId }) => {
  const run = pipelineRuns.get(runId);
  if (!run) return { content: [{ type: "text", text: JSON.stringify({ error: "Run not found", runId }) }], isError: true };
  if (!["pending", "running"].includes(run.status)) return { content: [{ type: "text", text: JSON.stringify({ error: `Cannot cancel run in ${run.status} status` }) }], isError: true };
  run.status = "cancelled";
  run.endTime = new Date().toISOString();
  run.logs.push(`[${new Date().toISOString()}] Cancelled by user`);
  return { content: [{ type: "text", text: JSON.stringify({ success: true, run }, null, 2) }] });
});

// ============================================
// TOOLS - DATA QUALITY
// ============================================

server.tool("create-quality-check", "Create data quality check", {
  name: z.string(),
  description: z.string(),
  pipelineId: z.string(),
  checkType: z.string(),
  config: z.record(z.unknown()),
  threshold: z.number().default(0),
  severity: z.enum(["info", "warning", "critical"]).default("warning"),
}, async ({ name, description, pipelineId, checkType, config, threshold, severity }) => {
  if (!pipelines.has(pipelineId)) return { content: [{ type: "text", text: JSON.stringify({ error: "Pipeline not found", pipelineId }) }], isError: true };

  const checkId = `qc-${Date.now().toString(36)}`;
  const check: DataQualityCheck = {
    id: checkId,
    name,
    description,
    pipelineId,
    checkType,
    config,
    threshold,
    severity,
    isActive: true,
  };
  qualityChecks.set(checkId, check);
  return { content: [{ type: "text", text: JSON.stringify(check, null, 2) }] });
});

server.tool("run-quality-checks", "Run quality checks for pipeline", {
  pipelineId: z.string(),
  runId: z.string(),
}, async ({ pipelineId, runId }) => {
  const pipeline = pipelines.get(pipelineId);
  const run = pipelineRuns.get(runId);
  if (!pipeline || !run) return { content: [{ type: "text", text: JSON.stringify({ error: "Pipeline or run not found" }) }], isError: true };

  const checks = Array.from(qualityChecks.values()).filter(c => c.pipelineId === pipelineId && c.isActive);
  const results = [];

  for (const check of checks) {
    await new Promise(r => setTimeout(r, 100));
    results.push({
      checkId: check.id,
      checkName: check.name,
      checkType: check.checkType,
      passed: true,
      value: 100000,
      threshold: check.threshold,
      severity: check.severity,
    });
  }

  return { content: [{ type: "text", text: JSON.stringify({ pipelineId, runId, results, allPassed: results.every(r => r.passed) }, null, 2) }] });
});

// ============================================
// RESOURCES
// ============================================

server.resource("datasource://{dataSourceId}", "Data Source", async (uri) => {
  const ds = dataSources.get(uri.params.dataSourceId);
  if (!ds) throw new Error(`Data source not found: ${uri.params.dataSourceId}`);
  return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(ds, null, 2) }] });
});

server.resource("transformation://{transformationId}", "Transformation", async (uri) => {
  const txn = transformations.get(uri.params.transformationId);
  if (!txn) throw new Error(`Transformation not found: ${uri.params.transformationId}`);
  return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(txn, null, 2) }] });
});

server.resource("pipeline://{pipelineId}", "Pipeline", async (uri) => {
  const pipeline = pipelines.get(uri.params.pipelineId);
  if (!pipeline) throw new Error(`Pipeline not found: ${uri.params.pipelineId}`);
  return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(pipeline, null, 2) }] });
});

server.resource("pipeline://{pipelineId}/runs", "Pipeline Runs", async (uri) => {
  const runs = Array.from(pipelineRuns.values()).filter(r => r.pipelineId === uri.params.pipelineId);
  runs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ pipelineId: uri.params.pipelineId, runs: runs.slice(0, 20) }, null, 2) }] });
});

server.resource("run://{runId}", "Pipeline Run", async (uri) => {
  const run = pipelineRuns.get(uri.params.runId);
  if (!run) throw new Error(`Run not found: ${uri.params.runId}`);
  return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(run, null, 2) }] });
});

server.resource("quality://{pipelineId}/checks", "Quality Checks", async (uri) => {
  const checks = Array.from(qualityChecks.values()).filter(c => c.pipelineId === uri.params.pipelineId);
  return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ pipelineId: uri.params.pipelineId, checks }, null, 2) }] });
});

// ============================================
// PROMPTS
// ============================================

server.prompt("pipeline-design", "Design a data pipeline", {
  businessRequirement: z.string(),
  sourceSystems: z.array(z.string()),
  destination: z.string(),
  frequency: z.string().default("daily"),
  sla: z.string().default("2 hours"),
}, ({ businessRequirement, sourceSystems, destination, frequency, sla }) => ({
  messages: [
    { role: "system", content: "You are a data engineering architect. Design scalable, reliable pipelines." },
    { role: "user", content: `Design a data pipeline for: ${businessRequirement}\nSource Systems: ${sourceSystems.join(", ")}\nDestination: ${destination}\nFrequency: ${frequency}\nSLA: ${sla}\nProvide: architecture, extraction strategy, transformation logic, loading strategy, error handling, monitoring, quality checks, capacity planning, cost estimation.` }
  ]
}));

server.prompt("debug-pipeline", "Debug pipeline failure", {
  pipelineId: z.string(),
  runId: z.string(),
  errorMessage: z.string(),
  logs: z.array(z.string()),
}, ({ pipelineId, runId, errorMessage, logs }) => ({
  messages: [
    { role: "system", content: "You are a data engineer debugging pipeline failures. Be systematic and practical." },
    { role: "user", content: `Debug this pipeline failure:\nPipeline: ${pipelineId}\nRun: ${runId}\nError: ${errorMessage}\nRecent Logs:\n${logs.slice(-20).join("\n")}\nAnalyze: root cause, affected stage, recovery steps, prevention, retry vs fix.` }
  ]
}));

server.prompt("optimize-pipeline", "Optimize pipeline performance", {
  pipelineId: z.string(),
  currentRuntime: z.string(),
  targetRuntime: z.string(),
  bottleneck: z.string().optional(),
}, ({ pipelineId, currentRuntime, targetRuntime, bottleneck }) => ({
  messages: [
    { role: "system", content: "You are a performance optimization expert. Provide actionable, measurable recommendations." },
    { role: "user", content: `Optimize pipeline performance:\nPipeline: ${pipelineId}\nCurrent Runtime: ${currentRuntime}\nTarget Runtime: ${targetRuntime}\nKnown Bottleneck: ${bottleneck || "Unknown"}\nProvide: performance analysis, specific optimizations, resource scaling, code improvements, trade-offs.` }
  ]
}));

// ============================================
// HEALTH CHECK
// ============================================

server.tool("health", "Health check", {}, async () => {
  const activePipelines = Array.from(pipelines.values()).filter(p => p.status === "active").length;
  const runningRuns = Array.from(pipelineRuns.values()).filter(r => r.status === "running").length;
  return { content: [{ type: "text", text: JSON.stringify({
    status: "healthy",
    timestamp: new Date().toISOString(),
    dataSources: dataSources.size,
    transformations: transformations.size,
    pipelines: { total: pipelines.size, active: activePipelines },
    runs: { total: pipelineRuns.size, running: runningRuns },
    qualityChecks: qualityChecks.size,
  }, null, 2) }] });
});

// Start server
async function main() {
  const transport = process.env.MCP_TRANSPORT || "websocket";
  const port = parseInt(process.env.MCP_PORT || "3000", 10);
  const host = process.env.MCP_HOST || "0.0.0.0";

  console.error(`Starting data-pipeline on ${transport}...`);

  if (transport === "websocket") await server.start({ transport: "websocket", port, host });
  else if (transport === "http-sse") await server.start({ transport: "http-sse", port, host });
  else if (transport === "grpc") await server.start({ transport: "grpc", port, host });
  else await server.start({ transport: "stdio" });

  console.error("Data pipeline server started");
}

main().catch((e) => { console.error("Failed:", e); process.exit(1); });
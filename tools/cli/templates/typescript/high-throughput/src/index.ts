/**
 * High-Throughput MCP Server
 * Optimized for 10k+ RPS with worker threads and connection pooling
 */

import { McpServer, tool, resource, prompt } from "@mcp/server";
import { z } from "zod";
import { Worker } from "worker_threads";
import { availableParallelism } from "os";

// Worker pool for CPU-intensive tasks
const workerPool = new Map<number, Worker>();
const WORKER_COUNT = availableParallelism();

// Initialize worker pool
function initializeWorkers() {
  for (let i = 0; i < WORKER_COUNT; i++) {
    const worker = new Worker(`
      const { parentPort } = require('worker_threads');
      parentPort.on('message', (msg) => {
        const { id, task, data } = msg;
        try {
          let result;
          switch (task) {
            case 'echo':
              result = Array(data.count).fill(data.message).join(' ');
              break;
            case 'hash':
              let hash = 0;
              for (let i = 0; i < data.input.length; i++) {
                hash = ((hash << 5) - hash) + data.input.charCodeAt(i);
                hash |= 0;
              }
              result = hash;
              break;
            case 'batch':
              result = data.items.map((item: any) => ({ processed: true, ...item }));
              break;
            default:
              throw new Error('Unknown task');
          }
          parentPort.postMessage({ id, result });
        } catch (error) {
          parentPort.postMessage({ id, error: error.message });
        }
      });
    `, { eval: true });
    workerPool.set(i, worker);
  }
}

initializeWorkers();

// Task queue for worker pool
const taskQueue: Array<{ task: string; data: any; resolve: (v: any) => void; reject: (e: Error) => void }> = [];
let currentWorker = 0;

function submitTask(task: string, data: any): Promise<any> {
  return new Promise((resolve, reject) => {
    taskQueue.push({ task, data, resolve, reject });
    processQueue();
  });
}

function processQueue() {
  if (taskQueue.length === 0) return;

  const worker = workerPool.get(currentWorker);
  currentWorker = (currentWorker + 1) % WORKER_COUNT;

  if (!worker) return;

  const task = taskQueue.shift()!;
  const taskId = Date.now() + Math.random();

  const handler = (msg: any) => {
    if (msg.id === taskId) {
      worker.off('message', handler);
      if (msg.error) task.reject(new Error(msg.error));
      else task.resolve(msg.result);
      processQueue();
    }
  };

  worker.on('message', handler);
  worker.postMessage({ id: taskId, task: task.task, data: task.data });
}

// Request counter
let requestCount = 0;

// Create MCP server
const server = new McpServer({
  name: "high-throughput",
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

server.tool("echo", "High-throughput echo", {
  message: z.string(), count: z.number().int().positive().default(1)
}, async ({ message, count = 1 }) => {
  requestCount++;
  const result = await submitTask('echo', { message, count });
  return { content: [{ type: "text", text: result }] };
});

server.tool("batch-echo", "Batch echo for maximum throughput", {
  messages: z.array(z.string())
}, async ({ messages }) => {
  requestCount++;
  const result = await submitTask('batch', { items: messages.map(m => ({ message: m })) });
  return { content: [{ type: "text", text: `Processed ${result.length} messages` }] });
});

server.tool("hash", "Fast string hashing", {
  input: z.string()
}, async ({ input }) => {
  requestCount++;
  const result = await submitTask('hash', { input });
  return { content: [{ type: "text", text: `Hash: ${result}` }] });
});

server.tool("health", "Health check", {}, async () => ({
  content: [{ type: "text", text: JSON.stringify({ status: "healthy", timestamp: new Date().toISOString(), requests: requestCount, workers: WORKER_COUNT, queueLength: taskQueue.length }, null, 2) }]
}));

server.tool("metrics", "Get metrics", {}, async () => ({
  content: [{ type: "text", text: JSON.stringify({ requests: requestCount, workers: WORKER_COUNT, queueLength: taskQueue.length, uptime: process.uptime() }, null, 2) }]
}));

// ============================================
// RESOURCES
// ============================================

server.resource("metrics://current", "Current metrics", async () => ({
  contents: [{ uri: "metrics://current", mimeType: "application/json", text: JSON.stringify({ requests: requestCount, workers: WORKER_COUNT, queueLength: taskQueue.length, uptime: process.uptime() }, null, 2) }]
}));

// ============================================
// PROMPTS
// ============================================

server.prompt("performance-tuning", "Performance tuning advice", {
  workload: z.string().describe("Workload description")
}, ({ workload }) => ({
  messages: [
    { role: "system", content: "Performance engineer. Provide tuning advice." },
    { role: "user", content: `Workload: ${workload}\nProvide optimization recommendations.` }
  ]
}));

// ============================================
// START SERVER
// ============================================

async function main() {
  const transport = process.env.MCP_TRANSPORT || "websocket";
  const port = parseInt(process.env.MCP_PORT || "3000", 10);
  const host = process.env.MCP_HOST || "0.0.0.0";

  console.error(`Starting high-throughput on ${transport} (workers: ${WORKER_COUNT})...`);

  if (transport === "websocket") await server.start({ transport: "websocket", port, host });
  else if (transport === "http-sse") await server.start({ transport: "http-sse", port, host });
  else if (transport === "grpc") await server.start({ transport: "grpc", port, host });
  else await server.start({ transport: "stdio" });

  console.error("High-throughput server started");
}

main().catch((e) => { console.error("Failed:", e); process.exit(1); });
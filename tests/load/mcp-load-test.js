// k6 Load Test for MCP Server
// Run with: k6 run tests/load/mcp-load-test.js
// Options: k6 run --vus 50 --duration 30s tests/load/mcp-load-test.js

import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const wsConnectTime = new Trend('ws_connect_time');
const wsMessageTime = new Trend('ws_message_time');
const toolCallDuration = new Trend('tool_call_duration');
const resourceReadDuration = new Trend('resource_read_duration');
const promptRenderDuration = new Trend('prompt_render_duration');
const errorRate = new Rate('errors');
const requestsTotal = new Counter('requests_total');

// Test configuration
export const options = {
  scenarios: {
    // WebSocket connection test
    websocket_connect: {
      executor: 'per-vu-iterations',
      vus: 50,
      iterations: 10,
      maxDuration: '30s',
      exec: 'websocketConnectTest',
    },
    // Tool invocation load test
    tool_invocation: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50 },   // Ramp up
        { duration: '1m', target: 50 },    // Stay at 50
        { duration: '30s', target: 100 },  // Spike to 100
        { duration: '1m', target: 100 },   // Stay at 100
        { duration: '30s', target: 0 },    // Ramp down
      ],
      exec: 'toolInvocationTest',
    },
    // Resource reading load test
    resource_reading: {
      executor: 'constant-vus',
      vus: 30,
      duration: '2m',
      exec: 'resourceReadingTest',
    },
    // Prompt rendering load test
    prompt_rendering: {
      executor: 'constant-vus',
      vus: 20,
      duration: '1m',
      exec: 'promptRenderingTest',
    },
    // Mixed workload
    mixed_workload: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 30 },
        { duration: '2m', target: 30 },
        { duration: '1m', target: 0 },
      ],
      exec: 'mixedWorkloadTest',
    },
  },
  thresholds: {
    // Connection thresholds
    'ws_connect_time': ['p(95)<1000', 'p(99)<2000'],
    // Message thresholds
    'ws_message_time': ['p(95)<100', 'p(99)<500'],
    // Tool call thresholds
    'tool_call_duration': ['p(95)<500', 'p(99)<1000'],
    // Resource read thresholds
    'resource_read_duration': ['p(95)<200', 'p(99)<500'],
    // Prompt render thresholds
    'prompt_render_duration': ['p(95)<500', 'p(99)<1000'],
    // Error rate
    'errors': ['rate<0.01'],  // Less than 1% errors
    // HTTP (if using HTTP/SSE)
    'http_req_duration': ['p(95)<500'],
    'http_req_failed': ['rate<0.01'],
  },
};

// WebSocket URL - can be overridden via environment variable
const WS_URL = __ENV.WS_URL || 'ws://localhost:3000';
const HTTP_URL = __ENV.HTTP_URL || 'http://localhost:3000';

// Unique client ID for this VU
let clientId = 0;

// Initialize connection and return WebSocket
function createConnection() {
  const url = `${WS_URL}?clientId=${__VU}-${__ITER}`;
  const startTime = new Date();

  return ws.connect(url, {}, function (socket) {
    const connectTime = new Date() - startTime;
    wsConnectTime.add(connectTime);

    socket.on('open', () => {
      // Send initialize
      const initMsg = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '1.0',
          capabilities: {},
          clientInfo: { name: 'k6-load-test', version: '1.0.0' }
        }
      };
      socket.send(JSON.stringify(initMsg));
    });

    socket.on('message', (message) => {
      const msgTime = new Date();
      try {
        const msg = JSON.parse(message);

        // Handle initialize response
        if (msg.id === 1 && msg.result) {
          // Send initialized notification
          socket.send(JSON.stringify({
            jsonrpc: '2.0',
            method: 'notifications/initialized',
            params: {}
          }));
        }

        wsMessageTime.add(new Date() - msgTime);
      } catch (e) {
        errorRate.add(1);
      }
    });

    socket.on('close', () => {
      // Connection closed
    });

    socket.on('error', (e) => {
      errorRate.add(1);
    });

    return socket;
  });
}

// Send JSON-RPC request and wait for response
function sendRequest(socket, method, params, id) {
  const startTime = new Date();

  return new Promise((resolve, reject) => {
    const requestId = id || Date.now() + Math.random();

    const handler = (message) => {
      try {
        const msg = JSON.parse(message);
        if (msg.id === requestId) {
          socket.removeListener('message', handler);
          const duration = new Date() - startTime;
          resolve({ msg, duration });
        }
      } catch (e) {
        socket.removeListener('message', handler);
        reject(e);
      }
    };

    socket.on('message', handler);

    socket.send(JSON.stringify({
      jsonrpc: '2.0',
      id: requestId,
      method,
      params
    }));

    // Timeout after 10 seconds
    setTimeout(() => {
      socket.removeListener('message', handler);
      reject(new Error('Request timeout'));
    }, 10000);
  });
}

// Test 1: WebSocket Connection Test
export function websocketConnectTest() {
  group('WebSocket Connection', () => {
    const socket = createConnection();

    if (!socket) {
      errorRate.add(1);
      return;
    }

    check(socket, { 'connected': (s) => s !== null });

    sleep(1);
    socket.close();
  });
}

// Test 2: Tool Invocation Load Test
export function toolInvocationTest() {
  group('Tool Invocation', () => {
    const socket = createConnection();

    if (!socket) {
      errorRate.add(1);
      return;
    }

    // Wait for connection to be ready
    sleep(0.5);

    // Test various tools
    const tools = [
      { name: 'echo', params: { message: `load-test-${__VU}-${__ITER}`, count: 1 } },
      { name: 'get-current-time', params: {} },
      { name: 'health', params: {} },
    ];

    for (const tool of tools) {
      try {
        const result = sendRequest(socket, 'tools/call', {
          name: tool.name,
          arguments: tool.params
        }, `tool-${tool.name}-${__ITER}`);

        const { msg, duration } = result;
        toolCallDuration.add(duration);
        requestsTotal.add(1);

        check(msg, {
          'tool call success': (m) => m.result && !m.error,
          'has content': (m) => m.result && m.result.content && m.result.content.length > 0,
        });

        if (msg.error) {
          errorRate.add(1);
        }
      } catch (e) {
        errorRate.add(1);
      }

      sleep(0.1); // Small delay between calls
    }

    socket.close();
  });
}

// Test 3: Resource Reading Load Test
export function resourceReadingTest() {
  group('Resource Reading', () => {
    const socket = createConnection();

    if (!socket) {
      errorRate.add(1);
      return;
    }

    sleep(0.5);

    const resources = [
      'server://info',
      'test://static',
      'test://resource/1',
      'test://resource/2',
    ];

    for (const uri of resources) {
      try {
        const result = sendRequest(socket, 'resources/read', { uri }, `resource-${uri}-${__ITER}`);

        const { msg, duration } = result;
        resourceReadDuration.add(duration);
        requestsTotal.add(1);

        check(msg, {
          'resource read success': (m) => m.result && !m.error,
          'has contents': (m) => m.result && m.result.contents && m.result.contents.length > 0,
        });

        if (msg.error) {
          errorRate.add(1);
        }
      } catch (e) {
        errorRate.add(1);
      }

      sleep(0.05);
    }

    socket.close();
  });
}

// Test 4: Prompt Rendering Load Test
export function promptRenderingTest() {
  group('Prompt Rendering', () => {
    const socket = createConnection();

    if (!socket) {
      errorRate.add(1);
      return;
    }

    sleep(0.5);

    const prompts = [
      { name: 'greeting', args: { name: `User-${__VU}`, style: 'friendly' } },
      { name: 'greeting', args: { name: `User-${__VU}`, style: 'formal' } },
      { name: 'greeting', args: { name: `User-${__VU}`, style: 'casual' } },
    ];

    for (const prompt of prompts) {
      try {
        const result = sendRequest(socket, 'prompts/get', {
          name: prompt.name,
          arguments: prompt.args
        }, `prompt-${prompt.name}-${__ITER}`);

        const { msg, duration } = result;
        promptRenderDuration.add(duration);
        requestsTotal.add(1);

        check(msg, {
          'prompt render success': (m) => m.result && !m.error,
          'has messages': (m) => m.result && m.result.messages && m.result.messages.length > 0,
        });

        if (msg.error) {
          errorRate.add(1);
        }
      } catch (e) {
        errorRate.add(1);
      }

      sleep(0.1);
    }

    socket.close();
  });
}

// Test 5: Mixed Workload Test
export function mixedWorkloadTest() {
  group('Mixed Workload', () => {
    const socket = createConnection();

    if (!socket) {
      errorRate.add(1);
      return;
    }

    sleep(0.5);

    // Simulate realistic usage pattern
    const operations = [
      // 40% tool calls
      () => sendRequest(socket, 'tools/call', { name: 'echo', arguments: { message: `mixed-${__ITER}` } }, `mixed-echo-${__ITER}`),
      () => sendRequest(socket, 'tools/call', { name: 'health', arguments: {} }, `mixed-health-${__ITER}`),
      // 30% resource reads
      () => sendRequest(socket, 'resources/read', { uri: 'server://info' }, `mixed-resource-${__ITER}`),
      () => sendRequest(socket, 'resources/read', { uri: 'test://static' }, `mixed-static-${__ITER}`),
      // 20% prompt renders
      () => sendRequest(socket, 'prompts/get', { name: 'greeting', arguments: { name: `User-${__VU}` } }, `mixed-prompt-${__ITER}`),
      // 10% list operations
      () => sendRequest(socket, 'tools/list', {}, `mixed-list-tools-${__ITER}`),
      () => sendRequest(socket, 'resources/list', {}, `mixed-list-resources-${__ITER}`),
    ];

    // Randomly select operations
    for (let i = 0; i < 10; i++) {
      const op = operations[Math.floor(Math.random() * operations.length)];

      try {
        const startTime = new Date();
        const result = op();
        const { msg, duration } = result;

        // Categorize duration based on operation type
        if (msg.method?.includes('tools/call') || msg.id?.toString().includes('tool')) {
          toolCallDuration.add(duration);
        } else if (msg.id?.toString().includes('resource')) {
          resourceReadDuration.add(duration);
        } else if (msg.id?.toString().includes('prompt')) {
          promptRenderDuration.add(duration);
        }

        requestsTotal.add(1);

        if (msg.error) {
          errorRate.add(1);
        }
      } catch (e) {
        errorRate.add(1);
      }

      sleep(Math.random() * 0.2); // Random delay 0-200ms
    }

    socket.close();
  });
}

// HTTP/SSE Test (alternative transport)
export function httpSseTest() {
  group('HTTP/SSE', () => {
    // Test initialize
    const initRes = http.post(`${HTTP_URL}/mcp`, JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '1.0', capabilities: {} }
    }), {
      headers: { 'Content-Type': 'application/json' },
    });

    check(initRes, {
      'init status 200': (r) => r.status === 200,
      'has result': (r) => r.json().result !== undefined,
    });

    // Test tool call via HTTP
    const toolRes = http.post(`${HTTP_URL}/mcp`, JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'echo', arguments: { message: 'http-test' } }
    }), {
      headers: { 'Content-Type': 'application/json' },
    });

    check(toolRes, {
      'tool call status 200': (r) => r.status === 200,
      'has content': (r) => r.json().result?.content !== undefined,
    });

    sleep(0.1);
  });
}

// Teardown - runs once after all tests
export function teardown() {
  console.log('Load test completed');
  console.log(`Total requests: ${requestsTotal.count}`);
}

// Handle graceful shutdown
export function handleSummary(data) {
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    'summary.json': JSON.stringify(data),
  };
}

function textSummary(data, options) {
  // Simple text summary
  let out = '\n=== Load Test Summary ===\n';
  out += `Total Requests: ${data.metrics.requests_total?.values?.count || 0}\n`;
  out += `Error Rate: ${(data.metrics.errors?.values?.rate * 100 || 0).toFixed(2)}%\n`;
  out += `WS Connect Time (p95): ${data.metrics.ws_connect_time?.values?.['p(95)'] || 0}ms\n`;
  out += `Tool Call Duration (p95): ${data.metrics.tool_call_duration?.values?.['p(95)'] || 0}ms\n`;
  out += `Resource Read Duration (p95): ${data.metrics.resource_read_duration?.values?.['p(95)'] || 0}ms\n`;
  out += `Prompt Render Duration (p95): ${data.metrics.prompt_render_duration?.values?.['p(95)'] || 0}ms\n`;
  return out;
}
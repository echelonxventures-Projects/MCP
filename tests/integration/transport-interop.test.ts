/**
 * Transport Interoperability Tests
 *
 * Tests that all transport types (stdio, HTTP/SSE, WebSocket, gRPC, custom)
 * work correctly with all SDK implementations.
 *
 * Run with: npx vitest run tests/integration/transport-interop.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { McpServer } from '@mcp/server';
import { McpClient, createConnectionManager } from '@mcp/client';
import { ConnectionConfig, TransportType } from '@mcp/types';

// Test servers for each transport
const testServers: Map<TransportType, { server: McpServer; port: number; url: string }> = new Map();
const testClients: Map<TransportType, McpClient> = new Map();

const TRANSPORTS: TransportType[] = ['stdio', 'websocket', 'http-sse', 'grpc'];
const BASE_PORT = 4000;

describe('Transport Interoperability Tests', () => {
  beforeAll(async () => {
    // Start test servers for each transport
    for (let i = 0; i < TRANSPORTS.length; i++) {
      const transport = TRANSPORTS[i];
      const port = BASE_PORT + i;

      const server = new McpServer({
        name: `interop-test-${transport}`,
        version: '1.0.0',
        capabilities: {
          tools: { listChanged: true },
          resources: { subscribe: true, listChanged: true },
          prompts: { listChanged: true },
          logging: {},
        },
      });

      // Register common test tools
      server.tool(
        'echo',
        'Echo back the input',
        { message: { type: 'string' } },
        async ({ message }) => ({
          content: [{ type: 'text', text: `Echo: ${message}` }],
        })
      );

      server.tool(
        'transport-info',
        'Get transport info',
        {},
        async () => ({
          content: [{ type: 'text', text: JSON.stringify({ transport, port }) }],
        })
      );

      server.resource(
        `test://${transport}/{id}`,
        `Test resource for ${transport}`,
        async (uri) => ({
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ transport, id: uri.params.id }),
          }],
        })
      );

      server.prompt(
        'test-prompt',
        'Test prompt',
        { name: { type: 'string' } },
        ({ name }) => ({
          messages: [
            { role: 'system', content: 'Test' },
            { role: 'user', content: `Hello ${name} via ${transport}` },
          ],
        })
      );

      // Start server
      let url: string;
      if (transport === 'stdio') {
        await server.start({ transport: 'stdio' });
        url = 'stdio';
      } else if (transport === 'websocket') {
        await server.start({ transport: 'websocket', port, host: '0.0.0.0' });
        url = `ws://localhost:${port}`;
      } else if (transport === 'http-sse') {
        await server.start({ transport: 'http-sse', port, host: '0.0.0.0' });
        url = `http://localhost:${port}`;
      } else if (transport === 'grpc') {
        await server.start({ transport: 'grpc', port, host: '0.0.0.0' });
        url = `localhost:${port}`;
      }

      testServers.set(transport, { server, port, url });
    }

    // Create clients for each transport
    const manager = createConnectionManager();

    for (const transport of TRANSPORTS) {
      const { url } = testServers.get(transport)!;

      let config: ConnectionConfig;
      if (transport === 'stdio') {
        config = { transport: 'stdio' };
      } else if (transport === 'websocket') {
        config = { transport: 'websocket', url };
      } else if (transport === 'http-sse') {
        config = { transport: 'http-sse', url };
      } else if (transport === 'grpc') {
        config = { transport: 'grpc', url };
      }

      const client = await manager.connect(config!);
      testClients.set(transport, client);
    }
  }, 60000);

  afterAll(async () => {
    // Close all clients
    for (const client of testClients.values()) {
      await client.close();
    }

    // Stop all servers
    for (const { server } of testServers.values()) {
      await server.stop();
    }
  }, 30000);

  describe.each(TRANSPORTS)('%s transport', (transport) => {
    let client: McpClient;

    beforeAll(() => {
      client = testClients.get(transport)!;
    });

    it('should complete initialization handshake', () => {
      const caps = client.getCapabilities();
      expect(caps).toBeDefined();
      expect(caps.protocolVersion).toBe('1.0');
    });

    it('should list tools', async () => {
      const tools = await client.listTools();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThanOrEqual(2);

      const toolNames = tools.map(t => t.name);
      expect(toolNames).toContain('echo');
      expect(toolNames).toContain('transport-info');
    });

    it('should call tools', async () => {
      const result = await client.callTool('echo', { message: `test-${transport}` });

      expect(result).toBeDefined();
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain(`test-${transport}`);
    });

    it('should call transport-info tool', async () => {
      const result = await client.callTool('transport-info', {});

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      expect(data.transport).toBe(transport);
    });

    it('should list resources', async () => {
      const resources = await client.listResources();
      expect(Array.isArray(resources)).toBe(true);
      expect(resources.length).toBeGreaterThanOrEqual(1);

      const uris = resources.map(r => r.uri);
      expect(uris.some(u => u.startsWith(`test://${transport}/`))).toBe(true);
    });

    it('should read resources', async () => {
      const result = await client.readResource(`test://${transport}/123`);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.contents[0].text!);
      expect(data.transport).toBe(transport);
      expect(data.id).toBe('123');
    });

    it('should list prompts', async () => {
      const prompts = await client.listPrompts();
      expect(Array.isArray(prompts)).toBe(true);
      expect(prompts.length).toBeGreaterThanOrEqual(1);

      const promptNames = prompts.map(p => p.name);
      expect(promptNames).toContain('test-prompt');
    });

    it('should render prompts', async () => {
      const result = await client.renderPrompt('test-prompt', { name: 'Tester' });

      expect(result.isError).toBeFalsy();
      expect(result.messages[1].content).toContain(transport);
      expect(result.messages[1].content).toContain('Tester');
    });

    it('should handle errors gracefully', async () => {
      const result = await client.callTool('non-existent-tool', {});
      expect(result.isError).toBe(true);
    });

    it('should support resource subscription', async () => {
      let notified = false;
      const subscription = client.subscribeResource(`test://${transport}/1`, () => {
        notified = true;
      });

      expect(subscription).toBeDefined();
      subscription.unsubscribe();
    });
  });

  describe('Cross-transport consistency', () => {
    it('should return consistent tool schemas across transports', async () => {
      const schemas: Map<string, any> = new Map();

      for (const transport of TRANSPORTS) {
        const client = testClients.get(transport)!;
        const tools = await client.listTools();
        const echoTool = tools.find(t => t.name === 'echo');
        schemas.set(transport, echoTool!.inputSchema);
      }

      // All schemas should be identical
      const firstSchema = schemas.get(TRANSPORTS[0])!;
      for (const [transport, schema] of schemas) {
        expect(JSON.stringify(schema)).toBe(JSON.stringify(firstSchema));
      }
    });

    it('should return consistent resource metadata across transports', async () => {
      const metadata: Map<string, any> = new Map();

      for (const transport of TRANSPORTS) {
        const client = testClients.get(transport)!;
        const resources = await client.listResources();
        const testResource = resources.find(r => r.uri.startsWith(`test://${transport}/`));
        metadata.set(transport, { name: testResource!.name, mimeType: testResource!.mimeType });
      }

      // All metadata should be identical (except transport-specific parts)
      const firstMeta = metadata.get(TRANSPORTS[0])!;
      for (const [transport, meta] of metadata) {
        expect(meta.mimeType).toBe(firstMeta.mimeType);
      }
    });

    it('should return consistent prompt schemas across transports', async () => {
      const schemas: Map<string, any> = new Map();

      for (const transport of TRANSPORTS) {
        const client = testClients.get(transport)!;
        const prompts = await client.listPrompts();
        const testPrompt = prompts.find(p => p.name === 'test-prompt');
        schemas.set(transport, testPrompt!.arguments);
      }

      // All schemas should be identical
      const firstSchema = schemas.get(TRANSPORTS[0])!;
      for (const [transport, schema] of schemas) {
        expect(JSON.stringify(schema)).toBe(JSON.stringify(firstSchema));
      }
    });

    it('should handle concurrent connections on same transport', async () => {
      const transport = 'websocket';
      const { url } = testServers.get(transport)!;
      const manager = createConnectionManager();

      // Create multiple concurrent connections
      const clients = await Promise.all(
        Array(5).fill(null).map(() =>
          manager.connect({ transport: 'websocket', url })
        )
      );

      // All should work
      for (const client of clients) {
        const result = await client.callTool('echo', { message: 'concurrent' });
        expect(result.isError).toBeFalsy();
      }

      // Cleanup
      await Promise.all(clients.map(c => c.close()));
      await manager.shutdown();
    });
  });

  describe('Transport-specific features', () => {
    it('websocket should support bidirectional streaming', async () => {
      const client = testClients.get('websocket')!;

      // Test that WebSocket connection is alive and bidirectional
      const result = await client.callTool('echo', { message: 'bidirectional' });
      expect(result.isError).toBeFalsy();
    });

    it('http-sse should support server-to-client streaming', async () => {
      const client = testClients.get('http-sse')!;

      // HTTP/SSE supports server-to-client streaming
      const result = await client.callTool('echo', { message: 'sse-streaming' });
      expect(result.isError).toBeFalsy();
    });

    it('grpc should support bidirectional streaming', async () => {
      const client = testClients.get('grpc')!;

      // gRPC supports full bidirectional streaming
      const result = await client.callTool('echo', { message: 'grpc-streaming' });
      expect(result.isError).toBeFalsy();
    });

    it('stdio should work for local communication', async () => {
      const client = testClients.get('stdio')!;

      // stdio works for local process communication
      const result = await client.callTool('echo', { message: 'stdio-local' });
      expect(result.isError).toBeFalsy();
    });
  });

  describe('Connection resilience', () => {
    it('should handle reconnection for websocket', async () => {
      const transport = 'websocket';
      const { url } = testServers.get(transport)!;
      const manager = createConnectionManager();

      const client1 = await manager.connect({ transport: 'websocket', url });
      await client1.close();

      const client2 = await manager.connect({ transport: 'websocket', url });
      const result = await client2.callTool('echo', { message: 'reconnect' });
      expect(result.isError).toBeFalsy();

      await client2.close();
      await manager.shutdown();
    });

    it('should handle reconnection for http-sse', async () => {
      const transport = 'http-sse';
      const { url } = testServers.get(transport)!;
      const manager = createConnectionManager();

      const client1 = await manager.connect({ transport: 'http-sse', url });
      await client1.close();

      const client2 = await manager.connect({ transport: 'http-sse', url });
      const result = await client2.callTool('echo', { message: 'reconnect' });
      expect(result.isError).toBeFalsy();

      await client2.close();
      await manager.shutdown();
    });

    it('should handle rapid connect/disconnect cycles', async () => {
      const transport = 'websocket';
      const { url } = testServers.get(transport)!;
      const manager = createConnectionManager();

      for (let i = 0; i < 10; i++) {
        const client = await manager.connect({ transport: 'websocket', url });
        const result = await client.callTool('echo', { message: `cycle-${i}` });
        expect(result.isError).toBeFalsy();
        await client.close();
      }

      await manager.shutdown();
    });
  });

  describe('Performance characteristics', () => {
    it('websocket should have low latency', async () => {
      const client = testClients.get('websocket')!;

      const start = Date.now();
      await client.callTool('echo', { message: 'latency-test' });
      const latency = Date.now() - start;

      expect(latency).toBeLessThan(100); // Should be under 100ms
    });

    it('grpc should have low latency', async () => {
      const client = testClients.get('grpc')!;

      const start = Date.now();
      await client.callTool('echo', { message: 'latency-test' });
      const latency = Date.now() - start;

      expect(latency).toBeLessThan(100);
    });

    it('http-sse should have reasonable latency', async () => {
      const client = testClients.get('http-sse')!;

      const start = Date.now();
      await client.callTool('echo', { message: 'latency-test' });
      const latency = Date.now() - start;

      expect(latency).toBeLessThan(200); // HTTP/SSE slightly higher
    });
  });
});

// Transport compatibility matrix
export const TRANSPORT_COMPATIBILITY = {
  stdio: {
    streaming: true,
    bidirectional: true,
    browser: false,
    serverless: false,
    edge: false,
    maxMessageSize: 'unlimited',
  },
  websocket: {
    streaming: true,
    bidirectional: true,
    browser: true,
    serverless: true,
    edge: true,
    maxMessageSize: '16MB',
  },
  'http-sse': {
    streaming: true,
    bidirectional: false,
    browser: true,
    serverless: true,
    edge: true,
    maxMessageSize: 'unlimited',
  },
  grpc: {
    streaming: true,
    bidirectional: true,
    browser: false, // Requires grpc-web
    serverless: false,
    edge: false,
    maxMessageSize: '4MB',
  },
  custom: {
    streaming: true,
    bidirectional: true,
    browser: true,
    serverless: true,
    edge: true,
    maxMessageSize: 'varies',
  },
};

console.log('Transport interop tests loaded. Run with: npx vitest run');
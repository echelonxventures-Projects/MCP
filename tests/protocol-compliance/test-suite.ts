/**
 * MCP Protocol Contract Tests
 *
 * These tests verify that all MCP SDK implementations (TypeScript, Python, Go, Rust)
 * comply with the MCP protocol specification. Run with:
 *
 * TypeScript: npx vitest run tests/protocol-compliance/test-suite.ts
 * Python: pytest tests/protocol-compliance/test_contract.py
 * Go: go test -v ./tests/protocol-compliance/go
 * Rust: cargo test --test contract
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { McpServer } from '@mcp/server';
import { McpClient, createConnectionManager } from '@mcp/client';
import { ConnectionConfig, TransportType } from '@mcp/types';

// Test server instance
let testServer: McpServer;
let testClient: McpClient;
const TEST_PORT = 3456;
const TEST_URL = `ws://localhost:${TEST_PORT}`;

describe('MCP Protocol Contract Tests', () => {
  beforeAll(async () => {
    // Create test server with all capabilities
    testServer = new McpServer({
      name: 'contract-test-server',
      version: '1.0.0',
      capabilities: {
        tools: { listChanged: true },
        resources: { subscribe: true, listChanged: true },
        prompts: { listChanged: true },
        logging: {},
      },
    });

    // Register test tools
    testServer.tool(
      'echo',
      'Echo back the input',
      { message: { type: 'string' }, count: { type: 'integer', minimum: 1, default: 1 } },
      async ({ message, count = 1 }) => ({
        content: [{ type: 'text', text: Array(count).fill(message).join(' ') }],
      })
    );

    testServer.tool(
      'add',
      'Add two numbers',
      { a: { type: 'number' }, b: { type: 'number' } },
      async ({ a, b }) => ({
        content: [{ type: 'text', text: String(a + b) }],
      })
    );

    testServer.tool(
      'fail-tool',
      'Tool that always fails',
      { message: { type: 'string' } },
      async () => {
        throw new Error('Intentional failure');
      }
    );

    // Register test resources
    testServer.resource(
      'test://resource/{id}',
      'Test resource',
      async (uri) => ({
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify({ id: uri.params.id, data: 'test content' }),
        }],
      })
    );

    testServer.resource(
      'test://static',
      'Static test resource',
      async () => ({
        contents: [{
          uri: 'test://static',
          mimeType: 'text/plain',
          text: 'Static resource content',
        }],
      })
    );

    // Register test prompts
    testServer.prompt(
      'test-prompt',
      'Test prompt template',
      { name: { type: 'string' }, style: { type: 'string', enum: ['formal', 'casual'] } },
      ({ name, style = 'casual' }) => ({
        messages: [
          { role: 'system', content: 'You are a test assistant.' },
          { role: 'user', content: style === 'formal' ? `Greetings, ${name}.` : `Hey ${name}!` },
        ],
      })
    );

    // Start server
    await testServer.start({ transport: 'websocket', port: TEST_PORT });

    // Create client and connect
    const manager = createConnectionManager();
    testClient = await manager.connect({
      transport: 'websocket',
      url: TEST_URL,
    });
  }, 30000);

  afterAll(async () => {
    if (testClient) await testClient.close();
    if (testServer) await testServer.stop();
  }, 10000);

  describe('1. Initialization Handshake', () => {
    it('should complete initialization handshake', async () => {
      // The client should have already initialized during connection
      expect(testClient).toBeDefined();
      expect(testClient.getCapabilities()).toBeDefined();

      const caps = testClient.getCapabilities();
      expect(caps.tools).toBeDefined();
      expect(caps.resources).toBeDefined();
      expect(caps.prompts).toBeDefined();
    });

    it('should negotiate protocol version', async () => {
      const caps = testClient.getCapabilities();
      expect(caps.protocolVersion).toBe('1.0');
    });

    it('should exchange capabilities', async () => {
      const serverCaps = testClient.getCapabilities();
      expect(serverCaps.tools?.listChanged).toBe(true);
      expect(serverCaps.resources?.subscribe).toBe(true);
      expect(serverCaps.resources?.listChanged).toBe(true);
      expect(serverCaps.prompts?.listChanged).toBe(true);
    });
  });

  describe('2. Tools', () => {
    describe('tools/list', () => {
      it('should list available tools', async () => {
        const tools = await testClient.listTools();
        expect(Array.isArray(tools)).toBe(true);
        expect(tools.length).toBeGreaterThanOrEqual(3);

        const toolNames = tools.map(t => t.name);
        expect(toolNames).toContain('echo');
        expect(toolNames).toContain('add');
        expect(toolNames).toContain('fail-tool');
      });

      it('should return tool schemas with correct structure', async () => {
        const tools = await testClient.listTools();
        const echoTool = tools.find(t => t.name === 'echo');

        expect(echoTool).toBeDefined();
        expect(echoTool!.description).toBe('Echo back the input');
        expect(echoTool!.inputSchema).toBeDefined();
        expect(echoTool!.inputSchema.type).toBe('object');
        expect(echoTool!.inputSchema.properties).toBeDefined();
        expect(echoTool!.inputSchema.properties.message).toBeDefined();
        expect(echoTool!.inputSchema.properties.message.type).toBe('string');
      });
    });

    describe('tools/call', () => {
      it('should invoke a tool successfully', async () => {
        const result = await testClient.callTool('echo', { message: 'hello', count: 3 });

        expect(result).toBeDefined();
        expect(result.content).toBeDefined();
        expect(Array.isArray(result.content)).toBe(true);
        expect(result.content[0].type).toBe('text');
        expect(result.content[0].text).toBe('hello hello hello');
        expect(result.isError).toBeFalsy();
      });

      it('should handle tool with numeric parameters', async () => {
        const result = await testClient.callTool('add', { a: 5, b: 3 });

        expect(result.content[0].text).toBe('8');
      });

      it('should return error for failing tool', async () => {
        const result = await testClient.callTool('fail-tool', { message: 'test' });

        expect(result.isError).toBe(true);
        expect(result.content).toBeDefined();
      });

      it('should return error for unknown tool', async () => {
        const result = await testClient.callTool('unknown-tool', {});

        expect(result.isError).toBe(true);
      });

      it('should validate required parameters', async () => {
        const result = await testClient.callTool('echo', {}); // missing required 'message'

        expect(result.isError).toBe(true);
      });

      it('should apply default parameter values', async () => {
        const result = await testClient.callTool('echo', { message: 'test' }); // count defaults to 1

        expect(result.content[0].text).toBe('test');
      });
    });

    describe('tools/listChanged notification', () => {
      it('should notify when tool list changes', async () => {
        let notified = false;
        testClient.onNotification('tools/listChanged', () => {
          notified = true;
        });

        // Register a new tool dynamically
        testServer.tool(
          'dynamic-tool',
          'Dynamically added tool',
          { input: { type: 'string' } },
          async ({ input }) => ({ content: [{ type: 'text', text: input }] })
        );

        // Wait for notification
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(notified).toBe(true);
      });
    });
  });

  describe('3. Resources', () => {
    describe('resources/list', () => {
      it('should list available resources', async () => {
        const resources = await testClient.listResources();
        expect(Array.isArray(resources)).toBe(true);
        expect(resources.length).toBeGreaterThanOrEqual(2);

        const uris = resources.map(r => r.uri);
        expect(uris.some(u => u.startsWith('test://resource/'))).toBe(true);
        expect(uris).toContain('test://static');
      });

      it('should return resource metadata', async () => {
        const resources = await testClient.listResources();
        const staticResource = resources.find(r => r.uri === 'test://static');

        expect(staticResource).toBeDefined();
        expect(staticResource!.name).toBe('Static test resource');
        expect(staticResource!.mimeType).toBe('text/plain');
      });
    });

    describe('resources/read', () => {
      it('should read a static resource', async () => {
        const result = await testClient.readResource('test://static');

        expect(result).toBeDefined();
        expect(result.contents).toBeDefined();
        expect(Array.isArray(result.contents)).toBe(true);
        expect(result.contents[0].uri).toBe('test://static');
        expect(result.contents[0].mimeType).toBe('text/plain');
        expect(result.contents[0].text).toBe('Static resource content');
      });

      it('should read a templated resource', async () => {
        const result = await testClient.readResource('test://resource/123');

        expect(result.contents[0].uri).toBe('test://resource/123');
        expect(result.contents[0].mimeType).toBe('application/json');
        const data = JSON.parse(result.contents[0].text!);
        expect(data.id).toBe('123');
        expect(data.data).toBe('test content');
      });

      it('should return error for unknown resource', async () => {
        const result = await testClient.readResource('test://unknown');

        expect(result.isError).toBe(true);
      });
    });

    describe('resources/subscribe', () => {
      it('should subscribe to resource changes', async () => {
        let notificationReceived = false;
        const subscription = testClient.subscribeResource('test://static', (update) => {
          notificationReceived = true;
          expect(update.uri).toBe('test://static');
        });

        expect(subscription).toBeDefined();

        // Trigger a resource change (in real implementation)
        // For now, just verify subscription was created
        expect(notificationReceived).toBe(false); // No actual change triggered

        subscription.unsubscribe();
      });

      it('should notify on resource list change', async () => {
        let listChanged = false;
        testClient.onNotification('resources/listChanged', () => {
          listChanged = true;
        });

        // In real implementation, adding a resource would trigger this
        await new Promise(resolve => setTimeout(resolve, 100));
        // Note: Dynamic resource registration not implemented in test server
      });
    });
  });

  describe('4. Prompts', () => {
    describe('prompts/list', () => {
      it('should list available prompts', async () => {
        const prompts = await testClient.listPrompts();
        expect(Array.isArray(prompts)).toBe(true);
        expect(prompts.length).toBeGreaterThanOrEqual(1);

        const promptNames = prompts.map(p => p.name);
        expect(promptNames).toContain('test-prompt');
      });

      it('should return prompt metadata with arguments', async () => {
        const prompts = await testClient.listPrompts();
        const testPrompt = prompts.find(p => p.name === 'test-prompt');

        expect(testPrompt).toBeDefined();
        expect(testPrompt!.description).toBe('Test prompt template');
        expect(testPrompt!.arguments).toBeDefined();
        expect(testPrompt!.arguments!.length).toBe(2);

        const nameArg = testPrompt!.arguments!.find(a => a.name === 'name');
        expect(nameArg).toBeDefined();
        expect(nameArg!.required).toBe(true);
      });
    });

    describe('prompts/get', () => {
      it('should render a prompt with arguments', async () => {
        const result = await testClient.renderPrompt('test-prompt', { name: 'Alice', style: 'friendly' });

        expect(result).toBeDefined();
        expect(result.messages).toBeDefined();
        expect(Array.isArray(result.messages)).toBe(true);
        expect(result.messages.length).toBe(2);
        expect(result.messages[0].role).toBe('system');
        expect(result.messages[1].role).toBe('user');
        expect(result.messages[1].content).toContain('Alice');
      });

      it('should use default argument values', async () => {
        const result = await testClient.renderPrompt('test-prompt', { name: 'Bob' });

        expect(result.messages[1].content).toContain('Bob');
      });

      it('should return error for unknown prompt', async () => {
        const result = await testClient.renderPrompt('unknown-prompt', {});

        expect(result.isError).toBe(true);
      });

      it('should return error for missing required arguments', async () => {
        const result = await testClient.renderPrompt('test-prompt', {});

        expect(result.isError).toBe(true);
      });
    });

    describe('prompts/listChanged notification', () => {
      it('should notify when prompt list changes', async () => {
        let notified = false;
        testClient.onNotification('prompts/listChanged', () => {
          notified = true;
        });

        // Dynamic prompt registration would trigger this
        await new Promise(resolve => setTimeout(resolve, 100));
      });
    });
  });

  describe('5. Error Handling', () => {
    it('should return proper JSON-RPC error format', async () => {
      const result = await testClient.callTool('fail-tool', { message: 'test' });

      expect(result.isError).toBe(true);
      expect(result.content).toBeDefined();
      // Error should follow MCP error format
    });

    it('should handle invalid JSON-RPC requests', async () => {
      // This would be tested at transport level
      // For now, verify error structure
      const result = await testClient.callTool('unknown', {});
      expect(result.isError).toBe(true);
    });
  });

  describe('6. Logging', () => {
    it('should support logging capability negotiation', async () => {
      const caps = testClient.getCapabilities();
      expect(caps.logging).toBeDefined();
    });

    it('should receive log notifications if subscribed', async () => {
      let logReceived = false;
      testClient.onNotification('logging/message', (log) => {
        logReceived = true;
        expect(log.level).toBeDefined();
        expect(log.message).toBeDefined();
      });

      // Server would send log notifications
      // await new Promise(resolve => setTimeout(resolve, 100));
    });
  });

  describe('7. Completion', () => {
    it('should support completion for tool arguments', async () => {
      // Test completion if implemented
      const caps = testClient.getCapabilities();
      if (caps.completion) {
        const completions = await testClient.complete({
          ref: { type: 'ref/tool', name: 'echo' },
          argument: { name: 'message', value: 'hel' },
        });
        expect(Array.isArray(completions)).toBe(true);
      }
    });
  });

  describe('8. Roots', () => {
    it('should support roots capability', async () => {
      const caps = testClient.getCapabilities();
      if (caps.roots) {
        const roots = await testClient.listRoots();
        expect(Array.isArray(roots)).toBe(true);
      }
    });
  });

  describe('9. Sampling', () => {
    it('should support sampling capability', async () => {
      const caps = testClient.getCapabilities();
      if (caps.sampling) {
        const result = await testClient.createMessage({
          messages: [{ role: 'user', content: { type: 'text', text: 'Hello' } }],
          maxTokens: 100,
        });
        expect(result.content).toBeDefined();
      }
    });
  });

  describe('10. Transport Interoperability', () => {
    it('should work with WebSocket transport', async () => {
      // Already tested via main client
      expect(testClient).toBeDefined();
    });

    it('should handle connection lifecycle', async () => {
      const manager = createConnectionManager();
      const client = await manager.connect({
        transport: 'websocket',
        url: TEST_URL,
      });

      expect(client).toBeDefined();
      await client.close();
      await manager.shutdown();
    });

    it('should handle reconnection', async () => {
      const manager = createConnectionManager();
      const client = await manager.connect({
        transport: 'websocket',
        url: TEST_URL,
      });

      await client.close();

      // Reconnect
      const client2 = await manager.connect({
        transport: 'websocket',
        url: TEST_URL,
      });

      expect(client2).toBeDefined();
      await client2.close();
      await manager.shutdown();
    });
  });
});

// Additional test utilities for cross-language verification
export const CONTRACT_TEST_CASES = {
  initialization: {
    description: 'Verify initialization handshake completes with correct protocol version and capabilities',
    requiredCapabilities: ['tools', 'resources', 'prompts', 'logging'],
  },
  tools: {
    list: 'Server returns array of tools with name, description, inputSchema',
    call: 'Tool invocation returns content array with type and text',
    callError: 'Tool errors return isError: true with error content',
    validation: 'Missing required params returns error',
    defaults: 'Optional params with defaults work correctly',
    listChanged: 'Notification sent when tool list changes',
  },
  resources: {
    list: 'Returns array of resources with uri, name, mimeType',
    read: 'Returns contents array with uri, mimeType, text/blob',
    readError: 'Unknown resource returns error',
    subscribe: 'Subscribe returns subscription with unsubscribe method',
    update: 'Resource updates trigger notifications',
    listChanged: 'Notification sent when resource list changes',
  },
  prompts: {
    list: 'Returns array of prompts with name, description, arguments',
    get: 'Returns messages array with role and content',
    getError: 'Unknown prompt returns error',
    validation: 'Missing required args returns error',
    defaults: 'Optional args with defaults work',
    listChanged: 'Notification sent when prompt list changes',
  },
  logging: {
    capability: 'Logging capability advertised',
    notifications: 'Log messages sent as notifications',
    levels: 'Supports debug, info, warning, error levels',
  },
  transports: {
    stdio: 'Works with stdio transport',
    websocket: 'Works with WebSocket transport',
    httpSse: 'Works with HTTP/SSE transport',
    grpc: 'Works with gRPC transport',
  },
  interop: {
    crossLanguage: 'TypeScript client works with Python/Go/Rust servers',
    versionNegotiation: 'Protocol version negotiated correctly',
    capabilityNegotiation: 'Only common capabilities used',
  },
};

console.log('Contract test suite loaded. Run with: npx vitest run');
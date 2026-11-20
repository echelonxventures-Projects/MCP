/**
 * {{projectName}} - MCP Server
 * {{description}}
 */

import { McpServer, tool, resource, prompt } from "@mcp/server";
import { z } from "zod";

// Create MCP server instance
const server = new McpServer({
  name: "{{projectName}}",
  version: "1.0.0",
  capabilities: {
    tools: { listChanged: true },
    resources: { subscribe: true, listChanged: true },
    prompts: { listChanged: true },
    logging: {},
  },
});

// Example tool: echo
server.tool(
  "echo",
  "Echo back the input message",
  {
    message: z.string().describe("Message to echo"),
    count: z.number().int().positive().optional().describe("Number of times to repeat"),
  },
  async ({ message, count = 1 }) => {
    const result = Array(count).fill(message).join(" ");
    return {
      content: [{ type: "text", text: result }],
    };
  }
);

// Example tool: get-current-time
server.tool(
  "get-current-time",
  "Get the current server time",
  {},
  async () => {
    return {
      content: [{ type: "text", text: new Date().toISOString() }],
    };
  }
);

// Example resource: server info
server.resource(
  "server://info",
  "Server information",
  async (uri) => {
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({
            name: "{{projectName}}",
            version: "1.0.0",
            description: "{{description}}",
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
          }, null, 2),
        },
      ],
    };
  }
);

// Example prompt: greeting
server.prompt(
  "greeting",
  "Generate a friendly greeting",
  {
    name: z.string().describe("Name to greet"),
    style: z.enum(["formal", "casual", "friendly"]).optional().describe("Greeting style"),
  },
  ({ name, style = "friendly" }) => {
    const greetings = {
      formal: `Good day, ${name}. How may I assist you?`,
      casual: `Hey ${name}! What's up?`,
      friendly: `Hello ${name}! 👋 It's great to see you. How can I help today?`,
    };

    return {
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant.",
        },
        {
          role: "user",
          content: greetings[style],
        },
      ],
    };
  }
);

// Health check endpoint
server.tool(
  "health",
  "Health check endpoint",
  {},
  async () => {
    return {
      content: [{ type: "text", text: JSON.stringify({ status: "healthy", timestamp: new Date().toISOString() }) }],
    };
  }
);

// Start server
async function main() {
  const transport = process.env.MCP_TRANSPORT || "stdio";
  const port = parseInt(process.env.MCP_PORT || "3000", 10);
  const host = process.env.MCP_HOST || "0.0.0.0";

  console.error(`Starting {{projectName}} on ${transport}...`);

  if (transport === "websocket") {
    await server.start({ transport: "websocket", port, host });
  } else if (transport === "http-sse") {
    await server.start({ transport: "http-sse", port, host });
  } else if (transport === "grpc") {
    await server.start({ transport: "grpc", port, host });
  } else {
    await server.start({ transport: "stdio" });
  }

  console.error("Server started successfully");
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
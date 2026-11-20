"""
{{projectName}} - MCP Server
{{description}}
"""

from mcp_server import McpServer, tool, resource, prompt
from pydantic import BaseModel, Field
from typing import Optional
import asyncio
import os
import json
from datetime import datetime


# Create MCP server instance
server = McpServer(
    name="{{projectName}}",
    version="1.0.0",
    capabilities={
        "tools": {"listChanged": True},
        "resources": {"subscribe": True, "listChanged": True},
        "prompts": {"listChanged": True},
        "logging": {},
    }
)


# Pydantic models for tool parameters
class EchoParams(BaseModel):
    message: str = Field(description="Message to echo")
    count: Optional[int] = Field(default=1, description="Number of times to repeat", ge=1)


class GreetingParams(BaseModel):
    name: str = Field(description="Name to greet")
    style: Optional[str] = Field(default="friendly", description="Greeting style", pattern="^(formal|casual|friendly)$")


# Example tool: echo
@server.tool("echo", "Echo back the input message")
async def echo(params: EchoParams) -> dict:
    result = " ".join([params.message] * params.count)
    return {
        "content": [{"type": "text", "text": result}],
    }


# Example tool: get-current-time
@server.tool("get-current-time", "Get the current server time")
async def get_current_time() -> dict:
    return {
        "content": [{"type": "text", "text": datetime.utcnow().isoformat()}],
    }


# Example resource: server info
@server.resource("server://info", "Server information")
async def server_info(uri) -> dict:
    return {
        "contents": [
            {
                "uri": str(uri),
                "mimeType": "application/json",
                "text": json.dumps({
                    "name": "{{projectName}}",
                    "version": "1.0.0",
                    "description": "{{description}}",
                    "uptime": 0,  # Would track actual uptime
                    "timestamp": datetime.utcnow().isoformat(),
                }, indent=2),
            },
        ],
    }


# Example prompt: greeting
@server.prompt("greeting", "Generate a friendly greeting")
async def greeting(params: GreetingParams) -> dict:
    greetings = {
        "formal": f"Good day, {params.name}. How may I assist you?",
        "casual": f"Hey {params.name}! What's up?",
        "friendly": f"Hello {params.name}! 👋 It's great to see you. How can I help today?",
    }

    return {
        "messages": [
            {
                "role": "system",
                "content": "You are a helpful assistant.",
            },
            {
                "role": "user",
                "content": greetings[params.style],
            },
        ],
    }


# Health check endpoint
@server.tool("health", "Health check endpoint")
async def health() -> dict:
    return {
        "content": [{
            "type": "text",
            "text": json.dumps({
                "status": "healthy",
                "timestamp": datetime.utcnow().isoformat(),
            }, indent=2),
        }],
    }


async def main():
    transport = os.getenv("MCP_TRANSPORT", "stdio")
    port = int(os.getenv("MCP_PORT", "3000"))
    host = os.getenv("MCP_HOST", "0.0.0.0")

    print(f"Starting {{projectName}} on {transport}...", file=__import__("sys").stderr)

    if transport == "websocket":
        await server.start(transport="websocket", port=port, host=host)
    elif transport == "http-sse":
        await server.start(transport="http-sse", port=port, host=host)
    elif transport == "grpc":
        await server.start(transport="grpc", port=port, host=host)
    else:
        await server.start(transport="stdio")

    print("Server started successfully", file=__import__("sys").stderr)


if __name__ == "__main__":
    asyncio.run(main())
"""
MCP Protocol Contract Tests - Python Version

Run with: pytest tests/protocol-compliance/test_contract.py -v
"""

import pytest
import asyncio
import json
from typing import Dict, Any, List
from mcp_client import create_connection_manager, McpClient
from mcp_types import ConnectionConfig


# Test configuration
TEST_PORT = 3457
TEST_URL = f"ws://localhost:{TEST_PORT}"


class TestMCPProtocolContract:
    """Contract tests for MCP protocol compliance."""

    @pytest.fixture(scope="class")
    async def client(self):
        """Create and connect MCP client."""
        manager = create_connection_manager()
        client = await manager.connect(ConnectionConfig(
            transport="websocket",
            url=TEST_URL
        ))
        yield client
        await client.close()
        await manager.shutdown()

    @pytest.fixture(scope="class")
    def server_caps(self, client):
        """Get server capabilities."""
        return client.get_capabilities()

    # ============================================
    # 1. Initialization Handshake
    # ============================================

    def test_initialization_handshake(self, client):
        """Verify initialization handshake completes."""
        assert client is not None
        caps = client.get_capabilities()
        assert caps is not None

    def test_protocol_version_negotiation(self, server_caps):
        """Verify protocol version is negotiated."""
        assert server_caps.protocol_version == "1.0"

    def test_capabilities_exchange(self, server_caps):
        """Verify capabilities are exchanged."""
        assert server_caps.tools is not None
        assert server_caps.tools.list_changed is True
        assert server_caps.resources is not None
        assert server_caps.resources.subscribe is True
        assert server_caps.resources.list_changed is True
        assert server_caps.prompts is not None
        assert server_caps.prompts.list_changed is True

    # ============================================
    # 2. Tools
    # ============================================

    @pytest.mark.asyncio
    async def test_list_tools(self, client):
        """Test tools/list method."""
        tools = await client.list_tools()
        assert isinstance(tools, list)
        assert len(tools) >= 3

        tool_names = [t.name for t in tools]
        assert "echo" in tool_names
        assert "add" in tool_names
        assert "fail-tool" in tool_names

    @pytest.mark.asyncio
    async def test_tool_schema_structure(self, client):
        """Test tool schema has correct structure."""
        tools = await client.list_tools()
        echo_tool = next(t for t in tools if t.name == "echo")

        assert echo_tool.description == "Echo back the input"
        assert echo_tool.input_schema is not None
        assert echo_tool.input_schema.type == "object"
        assert "message" in echo_tool.input_schema.properties
        assert echo_tool.input_schema.properties["message"].type == "string"

    @pytest.mark.asyncio
    async def test_call_tool_success(self, client):
        """Test successful tool invocation."""
        result = await client.call_tool("echo", {"message": "hello", "count": 3})

        assert result is not None
        assert result.content is not None
        assert isinstance(result.content, list)
        assert result.content[0].type == "text"
        assert result.content[0].text == "hello hello hello"
        assert result.is_error is False

    @pytest.mark.asyncio
    async def test_call_tool_numeric_params(self, client):
        """Test tool with numeric parameters."""
        result = await client.call_tool("add", {"a": 5, "b": 3})
        assert result.content[0].text == "8"

    @pytest.mark.asyncio
    async def test_call_tool_error(self, client):
        """Test tool that returns error."""
        result = await client.call_tool("fail-tool", {"message": "test"})
        assert result.is_error is True

    @pytest.mark.asyncio
    async def test_call_unknown_tool(self, client):
        """Test calling unknown tool returns error."""
        result = await client.call_tool("unknown-tool", {})
        assert result.is_error is True

    @pytest.mark.asyncio
    async def test_call_tool_missing_required_param(self, client):
        """Test validation of required parameters."""
        result = await client.call_tool("echo", {})  # missing 'message'
        assert result.is_error is True

    @pytest.mark.asyncio
    async def test_call_tool_default_params(self, client):
        """Test default parameter values."""
        result = await client.call_tool("echo", {"message": "test"})  # count defaults to 1
        assert result.content[0].text == "test"

    # ============================================
    # 3. Resources
    # ============================================

    @pytest.mark.asyncio
    async def test_list_resources(self, client):
        """Test resources/list method."""
        resources = await client.list_resources()
        assert isinstance(resources, list)
        assert len(resources) >= 2

        uris = [r.uri for r in resources]
        assert any(u.startswith("test://resource/") for u in uris)
        assert "test://static" in uris

    @pytest.mark.asyncio
    async def test_resource_metadata(self, client):
        """Test resource metadata structure."""
        resources = await client.list_resources()
        static_resource = next(r for r in resources if r.uri == "test://static")

        assert static_resource.name == "Static test resource"
        assert static_resource.mime_type == "text/plain"

    @pytest.mark.asyncio
    async def test_read_static_resource(self, client):
        """Test reading static resource."""
        result = await client.read_resource("test://static")

        assert result is not None
        assert result.contents is not None
        assert isinstance(result.contents, list)
        assert result.contents[0].uri == "test://static"
        assert result.contents[0].mime_type == "text/plain"
        assert result.contents[0].text == "Static resource content"

    @pytest.mark.asyncio
    async def test_read_templated_resource(self, client):
        """Test reading templated resource."""
        result = await client.read_resource("test://resource/123")

        assert result.contents[0].uri == "test://resource/123"
        assert result.contents[0].mime_type == "application/json"
        data = json.loads(result.contents[0].text)
        assert data["id"] == "123"
        assert data["data"] == "test content"

    @pytest.mark.asyncio
    async def test_read_unknown_resource(self, client):
        """Test reading unknown resource returns error."""
        result = await client.read_resource("test://unknown")
        assert result.is_error is True

    @pytest.mark.asyncio
    async def test_subscribe_resource(self, client):
        """Test resource subscription."""
        notifications = []

        def handler(update):
            notifications.append(update)

        subscription = client.subscribe_resource("test://static", handler)
        assert subscription is not None

        # In real implementation, server would send notification
        # For now verify subscription object exists
        subscription.unsubscribe()

    # ============================================
    # 4. Prompts
    # ============================================

    @pytest.mark.asyncio
    async def test_list_prompts(self, client):
        """Test prompts/list method."""
        prompts = await client.list_prompts()
        assert isinstance(prompts, list)
        assert len(prompts) >= 1

        prompt_names = [p.name for p in prompts]
        assert "test-prompt" in prompt_names

    @pytest.mark.asyncio
    async def test_prompt_metadata(self, client):
        """Test prompt metadata with arguments."""
        prompts = await client.list_prompts()
        test_prompt = next(p for p in prompts if p.name == "test-prompt")

        assert test_prompt.description == "Test prompt template"
        assert test_prompt.arguments is not None
        assert len(test_prompt.arguments) == 2

        name_arg = next(a for a in test_prompt.arguments if a.name == "name")
        assert name_arg.required is True

    @pytest.mark.asyncio
    async def test_render_prompt(self, client):
        """Test rendering prompt with arguments."""
        result = await client.render_prompt("test-prompt", {"name": "Alice", "style": "friendly"})

        assert result is not None
        assert result.messages is not None
        assert isinstance(result.messages, list)
        assert len(result.messages) == 2
        assert result.messages[0].role == "system"
        assert result.messages[1].role == "user"
        assert "Alice" in result.messages[1].content

    @pytest.mark.asyncio
    async def test_render_prompt_defaults(self, client):
        """Test prompt with default argument values."""
        result = await client.render_prompt("test-prompt", {"name": "Bob"})
        assert "Bob" in result.messages[1].content

    @pytest.mark.asyncio
    async def test_render_unknown_prompt(self, client):
        """Test rendering unknown prompt returns error."""
        result = await client.render_prompt("unknown-prompt", {})
        assert result.is_error is True

    @pytest.mark.asyncio
    async def test_render_prompt_missing_required(self, client):
        """Test rendering prompt with missing required args."""
        result = await client.render_prompt("test-prompt", {})
        assert result.is_error is True

    # ============================================
    # 5. Error Handling
    # ============================================

    @pytest.mark.asyncio
    async def test_error_format(self, client):
        """Test error response format."""
        result = await client.call_tool("fail-tool", {"message": "test"})
        assert result.is_error is True
        assert result.content is not None

    # ============================================
    # 6. Logging
    # ============================================

    def test_logging_capability(self, server_caps):
        """Test logging capability advertised."""
        assert server_caps.logging is not None

    # ============================================
    # 10. Transport Interoperability
    # ============================================

    @pytest.mark.asyncio
    async def test_websocket_transport(self, client):
        """Test WebSocket transport works."""
        assert client is not None

    @pytest.mark.asyncio
    async def test_connection_lifecycle(self):
        """Test connection lifecycle."""
        manager = create_connection_manager()
        client = await manager.connect(ConnectionConfig(
            transport="websocket",
            url=TEST_URL
        ))

        assert client is not None
        await client.close()
        await manager.shutdown()

    @pytest.mark.asyncio
    async def test_reconnection(self):
        """Test reconnection works."""
        manager = create_connection_manager()
        client1 = await manager.connect(ConnectionConfig(
            transport="websocket",
            url=TEST_URL
        ))

        await client1.close()

        client2 = await manager.connect(ConnectionConfig(
            transport="websocket",
            url=TEST_URL
        ))

        assert client2 is not None
        await client2.close()
        await manager.shutdown()


# Cross-language contract test cases definition
CONTRACT_TEST_CASES = {
    "initialization": {
        "description": "Verify initialization handshake completes with correct protocol version and capabilities",
        "required_capabilities": ["tools", "resources", "prompts", "logging"],
    },
    "tools": {
        "list": "Server returns array of tools with name, description, inputSchema",
        "call": "Tool invocation returns content array with type and text",
        "call_error": "Tool errors return isError: true with error content",
        "validation": "Missing required params returns error",
        "defaults": "Optional params with defaults work correctly",
        "list_changed": "Notification sent when tool list changes",
    },
    "resources": {
        "list": "Returns array of resources with uri, name, mimeType",
        "read": "Returns contents array with uri, mimeType, text/blob",
        "read_error": "Unknown resource returns error",
        "subscribe": "Subscribe returns subscription with unsubscribe method",
        "update": "Resource updates trigger notifications",
        "list_changed": "Notification sent when resource list changes",
    },
    "prompts": {
        "list": "Returns array of prompts with name, description, arguments",
        "get": "Returns messages array with role and content",
        "get_error": "Unknown prompt returns error",
        "validation": "Missing required args returns error",
        "defaults": "Optional args with defaults work",
        "list_changed": "Notification sent when prompt list changes",
    },
    "logging": {
        "capability": "Logging capability advertised",
        "notifications": "Log messages sent as notifications",
        "levels": "Supports debug, info, warning, error levels",
    },
    "transports": {
        "stdio": "Works with stdio transport",
        "websocket": "Works with WebSocket transport",
        "http_sse": "Works with HTTP/SSE transport",
        "grpc": "Works with gRPC transport",
    },
    "interop": {
        "cross_language": "TypeScript client works with Python/Go/Rust servers",
        "version_negotiation": "Protocol version negotiated correctly",
        "capability_negotiation": "Only common capabilities used",
    },
}


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
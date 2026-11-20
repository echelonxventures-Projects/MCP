"""
mcp_server - MCP Server Framework for Python
"""

from __future__ import annotations

import asyncio
import json
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, AsyncIterable, Callable, Dict, List, Optional, Union
from contextvars import ContextVar

from mcp_types import (
    MCPMessage,
    MCPError,
    Tool,
    Resource,
    Prompt,
    ServerCapabilities,
    ClientCapabilities,
    CallToolResult,
    ReadResourceResult,
    GetPromptResult,
    ListToolsResult,
    ListResourcesResult,
    ListPromptsResult,
    ToolAnnotations,
    ResourceAnnotations,
    PromptArgument,
    JSONSchema,
    create_mcp_error,
    ERROR_CODES,
    is_request,
    is_notification,
    is_response,
    is_error_response,
)
from mcp_transports import Transport, TransportConfig, create_transport


# ============================================================================
# Type Definitions
# ============================================================================

@dataclass
class ToolDefinition:
    name: str
    description: str
    input_schema: JSONSchema
    output_schema: Optional[JSONSchema] = None
    annotations: Optional[ToolAnnotations] = None
    handler: Callable[[Dict[str, Any], "ToolContext"], Any] = None


@dataclass
class ToolContext:
    request_id: Union[str, int]
    client_info: ClientCapabilities
    server_info: "ServerInfo"
    signal: asyncio.Event = field(default_factory=asyncio.Event)


@dataclass
class ResourceDefinition:
    uri_pattern: str
    name: str
    description: Optional[str] = None
    mime_type: Optional[str] = None
    annotations: Optional[ResourceAnnotations] = None
    handler: Callable[["ParsedUri", "ResourceContext"], Any] = None


@dataclass
class ParsedUri:
    href: str
    pattern: str
    params: Dict[str, str]


@dataclass
class ResourceContext:
    request_id: Union[str, int]
    client_info: ClientCapabilities


@dataclass
class PromptDefinition:
    name: str
    description: Optional[str] = None
    arguments: Optional[List[PromptArgument]] = None
    handler: Callable[[Dict[str, Any], "PromptContext"], Any] = None


@dataclass
class PromptContext:
    request_id: Union[str, int]
    client_info: ClientCapabilities


@dataclass
class ServerInfo:
    name: str
    version: str
    capabilities: ServerCapabilities


@dataclass
class ServerStartConfig:
    transport: Union[str, TransportConfig, Transport]
    port: Optional[int] = None
    host: Optional[str] = None


class ServerMiddleware:
    async def on_request(self, ctx: "RequestContext", next_fn: Callable[[], Any]) -> None:
        await next_fn()

    async def on_response(self, ctx: "ResponseContext", next_fn: Callable[[], Any]) -> None:
        await next_fn()

    async def on_error(self, ctx: "ErrorContext", error: Exception, next_fn: Callable[[], Any]) -> None:
        await next_fn()

    async def on_connect(self, ctx: "ConnectionContext") -> None:
        pass

    async def on_disconnect(self, ctx: "ConnectionContext", error: Optional[Exception]) -> None:
        pass


@dataclass
class ConnectionContext:
    connection_id: str
    transport: Transport
    client_capabilities: Optional[ClientCapabilities]
    server_capabilities: ServerCapabilities
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class RequestContext:
    request_id: Union[str, int]
    method: str
    params: Optional[Any]
    client_capabilities: ClientCapabilities
    server_capabilities: ServerCapabilities
    transport: Transport
    start_time: float
    message: MCPMessage


@dataclass
class ResponseContext:
    request_id: Union[str, int]
    method: str
    params: Optional[Any]
    client_capabilities: ClientCapabilities
    server_capabilities: ServerCapabilities
    transport: Transport
    start_time: float
    message: MCPMessage
    response: MCPMessage


@dataclass
class ErrorContext:
    request_id: Union[str, int]
    method: str
    params: Optional[Any]
    client_capabilities: ClientCapabilities
    server_capabilities: ServerCapabilities
    transport: Transport
    start_time: float
    message: MCPMessage
    error: Exception


# ============================================================================
# Server Implementation
# ============================================================================

class McpServer:
    def __init__(
        self,
        name: str,
        version: str,
        capabilities: Optional[ServerCapabilities] = None,
    ):
        self.name = name
        self.version = version
        self.capabilities = capabilities or {}
        self.tools: Dict[str, ToolDefinition] = {}
        self.resources: Dict[str, ResourceDefinition] = {}
        self.prompts: Dict[str, PromptDefinition] = {}
        self.middlewares: List[ServerMiddleware] = []
        self.transport: Optional[Transport] = None
        self.connections: Dict[str, ConnectionContext] = {}
        self.connection_counter = 0
        self.initialized = False
        self.client_capabilities: Optional[ClientCapabilities] = None
        self._message_loop_task: Optional[asyncio.Task] = None

    # ---------------------------------------------------------------------------
    # Capability Registration
    # ---------------------------------------------------------------------------

    def tool(self, defn: ToolDefinition) -> "McpServer":
        if defn.name in self.tools:
            raise ValueError(f"Tool already registered: {defn.name}")
        self.tools[defn.name] = defn
        return self

    def resource(self, defn: ResourceDefinition) -> "McpServer":
        if defn.uri_pattern in self.resources:
            raise ValueError(f"Resource already registered: {defn.uri_pattern}")
        self.resources[defn.uri_pattern] = defn
        return self

    def prompt(self, defn: PromptDefinition) -> "McpServer":
        if defn.name in self.prompts:
            raise ValueError(f"Prompt already registered: {defn.name}")
        self.prompts[defn.name] = defn
        return self

    # ---------------------------------------------------------------------------
    # Middleware
    # ---------------------------------------------------------------------------

    def use(self, middleware: ServerMiddleware) -> "McpServer":
        self.middlewares.append(middleware)
        return self

    # ---------------------------------------------------------------------------
    # Transport & Lifecycle
    # ---------------------------------------------------------------------------

    async def start(self, config: ServerStartConfig) -> None:
        if self.transport:
            raise RuntimeError("Server already started")

        if isinstance(config.transport, Transport):
            self.transport = config.transport
        elif isinstance(config.transport, str):
            self.transport = create_transport(
                TransportConfig(type=config.transport, port=config.port, host=config.host)
            )
        else:
            self.transport = create_transport(config.transport)

        self.transport.on_connect = self._handle_connect
        self.transport.on_disconnect = self._handle_disconnect
        self.transport.on_error = self._handle_transport_error

        await self.transport.connect()
        self._message_loop_task = asyncio.create_task(self._message_loop())

    async def stop(self) -> None:
        if not self.transport:
            return

        # Close all connections
        for conn_id in list(self.connections.keys()):
            await self._close_connection(conn_id, Exception("Server stopping"))

        await self.transport.disconnect()
        self.transport = None
        self.initialized = False
        self.client_capabilities = None

        if self._message_loop_task:
            self._message_loop_task.cancel()
            try:
                await self._message_loop_task
            except asyncio.CancelledError:
                pass

    # ---------------------------------------------------------------------------
    # Message Handling
    # ---------------------------------------------------------------------------

    async def _message_loop(self) -> None:
        if not self.transport:
            return

        async for message in self.transport.receive():
            await self._handle_message(message)

    async def _handle_message(self, message: MCPMessage) -> None:
        ctx = RequestContext(
            request_id=message.id or int(asyncio.get_event_loop().time() * 1000),
            method=message.method or "",
            params=message.params,
            client_capabilities=self.client_capabilities or {},
            server_capabilities=self.capabilities,
            transport=self.transport!,
            start_time=asyncio.get_event_loop().time(),
            message=message,
        )

        try:
            await self._run_request_middleware(ctx)
            response = await self._dispatch_message(message)

            if response:
                response_ctx = ResponseContext(
                    request_id=ctx.request_id,
                    method=ctx.method,
                    params=ctx.params,
                    client_capabilities=ctx.client_capabilities,
                    server_capabilities=ctx.server_capabilities,
                    transport=ctx.transport,
                    start_time=ctx.start_time,
                    message=ctx.message,
                    response=response,
                )
                await self._run_response_middleware(response_ctx)

                if self.transport:
                    await self.transport.send(response)
        except Exception as error:
            await self._handle_error(ctx, error)

    async def _dispatch_message(self, message: MCPMessage) -> Optional[MCPMessage]:
        if is_notification(message):
            await self._handle_notification(message)
            return None

        if is_request(message):
            return await self._handle_request(message)

        if is_response(message):
            # Server doesn't typically handle responses
            return None

        return create_mcp_error(message.id, ERROR_CODES.INVALID_REQUEST, "Unknown message type")

    async def _handle_notification(self, message: MCPMessage) -> None:
        if message.method == "initialized":
            self.initialized = True
        elif message.method == "cancelled":
            pass  # Handle cancellation
        # Other notifications

    async def _handle_request(self, message: MCPMessage) -> MCPMessage:
        method = message.method
        params = message.params
        id = message.id

        try:
            if method == "initialize":
                return await self._handle_initialize(params, id)
            elif method == "tools/list":
                return self._create_response(id, await self._handle_list_tools())
            elif method == "tools/call":
                return self._create_response(id, await self._handle_call_tool(params))
            elif method == "resources/list":
                return self._create_response(id, await self._handle_list_resources(params))
            elif method == "resources/read":
                return self._create_response(id, await self._handle_read_resource(params))
            elif method == "resources/subscribe":
                return self._create_response(id, {"subscribed": True})
            elif method == "resources/unsubscribe":
                return self._create_response(id, {"unsubscribed": True})
            elif method == "prompts/list":
                return self._create_response(id, await self._handle_list_prompts(params))
            elif method == "prompts/get":
                return self._create_response(id, await self._handle_get_prompt(params))
            elif method == "ping":
                return self._create_response(id, {})
            else:
                raise create_mcp_error(id, ERROR_CODES.METHOD_NOT_FOUND, f"Method not found: {method}")
        except MCPError:
            raise
        except Exception as e:
            raise create_mcp_error(id, ERROR_CODES.INTERNAL_ERROR, str(e))

    async def _handle_initialize(
        self,
        params: Dict[str, Any],
        id: Optional[Union[str, int]]
    ) -> MCPMessage:
        self.client_capabilities = params.get("capabilities", {})
        self.initialized = True

        return self._create_response(id, {
            "protocolVersion": "1.0",
            "capabilities": self.capabilities,
            "serverInfo": {
                "name": self.name,
                "version": self.version,
            },
        })

    async def _handle_list_tools(self) -> ListToolsResult:
        tools = [
            Tool(
                name=t.name,
                description=t.description,
                inputSchema=t.input_schema,
                outputSchema=t.output_schema,
                annotations=t.annotations,
            )
            for t in self.tools.values()
        ]
        return {"tools": tools}

    async def _handle_call_tool(self, params: Dict[str, Any]) -> CallToolResult:
        name = params.get("name")
        arguments = params.get("arguments", {})

        tool = self.tools.get(name)
        if not tool:
            raise create_mcp_error(None, ERROR_CODES.TOOL_NOT_FOUND, f"Tool not found: {name}")

        context = ToolContext(
            request_id=int(asyncio.get_event_loop().time() * 1000),
            client_info=self.client_capabilities or {},
            server_info=ServerInfo(self.name, self.version, self.capabilities),
        )

        try:
            result = await tool.handler(arguments, context)
            return result
        except Exception as e:
            return CallToolResult(
                content=[{"type": "text", "text": f"Tool error: {e}"}],
                isError=True,
            )

    async def _handle_list_resources(self, params: Optional[Dict[str, Any]]) -> ListResourcesResult:
        resources = [
            Resource(
                uri=r.uri_pattern,
                name=r.name,
                description=r.description,
                mimeType=r.mime_type,
                annotations=r.annotations,
            )
            for r in self.resources.values()
        ]
        return {"resources": resources}

    async def _handle_read_resource(self, params: Dict[str, Any]) -> ReadResourceResult:
        uri = params.get("uri")

        for pattern, resource in self.resources.items():
            parsed = self._parse_uri(pattern, uri)
            if parsed:
                context = ResourceContext(
                    request_id=int(asyncio.get_event_loop().time() * 1000),
                    client_info=self.client_capabilities or {},
                )
                return await resource.handler(parsed, context)

        raise create_mcp_error(None, ERROR_CODES.RESOURCE_NOT_FOUND, f"Resource not found: {uri}")

    async def _handle_list_prompts(self, params: Optional[Dict[str, Any]]) -> ListPromptsResult:
        prompts = [
            Prompt(
                name=p.name,
                description=p.description,
                arguments=p.arguments,
            )
            for p in self.prompts.values()
        ]
        return {"prompts": prompts}

    async def _handle_get_prompt(self, params: Dict[str, Any]) -> GetPromptResult:
        name = params.get("name")
        arguments = params.get("arguments", {})

        prompt = self.prompts.get(name)
        if not prompt:
            raise create_mcp_error(None, ERROR_CODES.PROMPT_NOT_FOUND, f"Prompt not found: {name}")

        context = PromptContext(
            request_id=int(asyncio.get_event_loop().time() * 1000),
            client_info=self.client_capabilities or {},
        )

        return await prompt.handler(arguments, context)

    # ---------------------------------------------------------------------------
    # Connection Management
    # ---------------------------------------------------------------------------

    def _handle_connect(self) -> None:
        self.connection_counter += 1
        conn_id = f"conn-{self.connection_counter}"
        ctx = ConnectionContext(
            connection_id=conn_id,
            transport=self.transport!,
            client_capabilities=self.client_capabilities,
            server_capabilities=self.capabilities,
        )
        self.connections[conn_id] = ctx
        asyncio.create_task(self._run_connect_middleware(ctx))

    def _handle_disconnect(self, error: Optional[Exception]) -> None:
        for conn_id, ctx in list(self.connections.items()):
            asyncio.create_task(self._run_disconnect_middleware(ctx, error))
            del self.connections[conn_id]

    def _handle_transport_error(self, error: Exception) -> None:
        pass  # Log error

    async def _close_connection(self, connection_id: str, error: Exception) -> None:
        ctx = self.connections.get(connection_id)
        if ctx:
            await self._run_disconnect_middleware(ctx, error)
            del self.connections[connection_id]

    # ---------------------------------------------------------------------------
    # Middleware Execution
    # ---------------------------------------------------------------------------

    async def _run_request_middleware(self, ctx: RequestContext) -> None:
        async def next_fn(index: int = 0) -> None:
            if index < len(self.middlewares):
                middleware = self.middlewares[index]
                if middleware.on_request:
                    await middleware.on_request(ctx, lambda: next_fn(index + 1))
                else:
                    await next_fn(index + 1)

        await next_fn()

    async def _run_response_middleware(self, ctx: ResponseContext) -> None:
        async def next_fn(index: int = len(self.middlewares) - 1) -> None:
            if index >= 0:
                middleware = self.middlewares[index]
                if middleware.on_response:
                    await middleware.on_response(ctx, lambda: next_fn(index - 1))
                else:
                    await next_fn(index - 1)

        await next_fn()

    async def _run_connect_middleware(self, ctx: ConnectionContext) -> None:
        for middleware in self.middlewares:
            if middleware.on_connect:
                await middleware.on_connect(ctx)

    async def _run_disconnect_middleware(self, ctx: ConnectionContext, error: Optional[Exception]) -> None:
        for middleware in self.middlewares:
            if middleware.on_disconnect:
                await middleware.on_disconnect(ctx, error)

    async def _handle_error(self, ctx: RequestContext, error: Exception) -> None:
        error_ctx = ErrorContext(
            request_id=ctx.request_id,
            method=ctx.method,
            params=ctx.params,
            client_capabilities=ctx.client_capabilities,
            server_capabilities=ctx.server_capabilities,
            transport=ctx.transport,
            start_time=ctx.start_time,
            message=ctx.message,
            error=error,
        )

        async def next_fn(index: int = len(self.middlewares) - 1) -> None:
            if index >= 0:
                middleware = self.middlewares[index]
                if middleware.on_error:
                    await middleware.on_error(error_ctx, error, lambda: next_fn(index - 1))
                else:
                    await next_fn(index - 1)

        await next_fn()

        error_response = create_mcp_error(ctx.request_id, ERROR_CODES.INTERNAL_ERROR, str(error))
        if self.transport:
            await self.transport.send(error_response)

    # ---------------------------------------------------------------------------
    # Utilities
    # ---------------------------------------------------------------------------

    def _parse_uri(self, pattern: str, uri: str) -> Optional[ParsedUri]:
        import re
        regex_pattern = pattern.replace(".", r"\.").replace("{", "(?P<").replace("}", ">[^/]+)")
        regex = re.compile(f"^{regex_pattern}$")
        match = regex.match(uri)

        if not match:
            return None

        return ParsedUri(href=uri, pattern=pattern, params=match.groupdict())

    def _create_response(self, id: Optional[Union[str, int]], result: Any) -> MCPMessage:
        return {"jsonrpc": "2.0", "id": id, "result": result}

    # ---------------------------------------------------------------------------
    # Public API
    # ---------------------------------------------------------------------------

    def get_tools(self) -> List[ToolDefinition]:
        return list(self.tools.values())

    def get_resources(self) -> List[ResourceDefinition]:
        return list(self.resources.values())

    def get_prompts(self) -> List[PromptDefinition]:
        return list(self.prompts.values())

    def get_server_info(self) -> ServerInfo:
        return ServerInfo(self.name, self.version, self.capabilities)

    def is_initialized(self) -> bool:
        return self.initialized

    def get_connection_count(self) -> int:
        return len(self.connections)


# ============================================================================
# Helper Functions
# ============================================================================

def create_tool(
    name: str,
    description: str,
    input_schema: JSONSchema,
    handler: Callable[[Dict[str, Any], ToolContext], Any],
    output_schema: Optional[JSONSchema] = None,
    annotations: Optional[ToolAnnotations] = None,
) -> ToolDefinition:
    return ToolDefinition(
        name=name,
        description=description,
        input_schema=input_schema,
        output_schema=output_schema,
        annotations=annotations,
        handler=handler,
    )


def create_resource(
    uri_pattern: str,
    name: str,
    handler: Callable[[ParsedUri, ResourceContext], Any],
    description: Optional[str] = None,
    mime_type: Optional[str] = None,
    annotations: Optional[ResourceAnnotations] = None,
) -> ResourceDefinition:
    return ResourceDefinition(
        uri_pattern=uri_pattern,
        name=name,
        description=description,
        mime_type=mime_type,
        annotations=annotations,
        handler=handler,
    )


def create_prompt(
    name: str,
    handler: Callable[[Dict[str, Any], PromptContext], Any],
    description: Optional[str] = None,
    arguments: Optional[List[PromptArgument]] = None,
) -> PromptDefinition:
    return PromptDefinition(
        name=name,
        description=description,
        arguments=arguments,
        handler=handler,
    )
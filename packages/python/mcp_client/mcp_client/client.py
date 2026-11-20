"""
mcp_client - MCP Client Framework for Python
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field
from typing import Any, AsyncIterable, Callable, Dict, List, Optional, Union
from contextvars import ContextVar

from mcp_types import (
    MCPMessage,
    MCPError,
    ServerCapabilities,
    ClientCapabilities,
    Tool,
    Resource,
    Prompt,
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
    is_response,
    is_error_response,
)
from mcp_transports import Transport, TransportConfig, create_transport


# ============================================================================
# Type Definitions
# ============================================================================

@dataclass
class ConnectionConfig:
    server_id: str
    transport: Union[str, TransportConfig, Transport]
    capabilities: Optional[ClientCapabilities] = None
    timeout: float = 30.0
    retry: Optional["RetryConfig"] = None
    failover: Optional["FailoverConfig"] = None


@dataclass
class RetryConfig:
    max_attempts: int = 3
    base_delay: float = 1.0
    max_delay: float = 10.0
    backoff_multiplier: float = 2.0
    retryable_errors: List[int] = field(default_factory=lambda: [
        ERROR_CODES.INTERNAL_ERROR,
        ERROR_CODES.SERVICE_UNAVAILABLE,
        ERROR_CODES.TIMEOUT,
    ])


@dataclass
class FailoverConfig:
    enabled: bool = False
    backup_servers: List[str] = field(default_factory=list)
    health_check_interval: float = 30.0
    failover_timeout: float = 5.0


@dataclass
class PoolConfig:
    max_connections: int = 10
    min_connections: int = 0
    acquire_timeout: float = 5.0
    idle_timeout: float = 60.0
    health_check_interval: float = 30.0


class ConnectionStatus:
    CONNECTING = "connecting"
    CONNECTED = "connected"
    DISCONNECTED = "disconnected"
    RECONNECTING = "reconnecting"
    FAILED = "failed"


@dataclass
class McpContext:
    request_id: str
    parent_request_id: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    trace_id: Optional[str] = None
    span_id: Optional[str] = None
    tenant_id: Optional[str] = None
    user_id: Optional[str] = None


class Connection:
    def __init__(
        self,
        server_id: str,
        transport: Transport,
        capabilities: ServerCapabilities,
        retry_config: RetryConfig,
        failover_config: FailoverConfig,
    ):
        self.server_id = server_id
        self.transport = transport
        self.capabilities = capabilities
        self.status = ConnectionStatus.CONNECTING
        self.connected_at = asyncio.get_event_loop().time()
        self.last_activity = asyncio.get_event_loop().time()
        self._request_id = 0
        self._pending: Dict[Union[str, int], asyncio.Future] = {}
        self._close_handlers: List[Callable[[Optional[Exception]], None]] = []
        self._error_handlers: List[Callable[[Exception], None]] = []
        self._retry_config = retry_config
        self._failover_config = failover_config
        self._closed = False
        self._health_check_task: Optional[asyncio.Task] = None

        self._setup_transport_handlers()

    def _setup_transport_handlers(self) -> None:
        self.transport.on_connect = self._on_connect
        self.transport.on_disconnect = self._on_disconnect
        self.transport.on_error = self._on_error

    def _on_connect(self) -> None:
        self.status = ConnectionStatus.CONNECTED
        self._start_health_check()

    def _on_disconnect(self, error: Optional[Exception]) -> None:
        self.status = ConnectionStatus.FAILED if error else ConnectionStatus.DISCONNECTED
        self._stop_health_check()
        self._reject_all_pending(error or Exception("Connection closed"))
        for handler in self._close_handlers:
            handler(error)

    def _on_error(self, error: Exception) -> None:
        for handler in self._error_handlers:
            handler(error)

    def _start_health_check(self) -> None:
        if self._failover_config.enabled and self._failover_config.health_check_interval > 0:
            self._health_check_task = asyncio.create_task(self._health_check_loop())

    def _stop_health_check(self) -> None:
        if self._health_check_task:
            self._health_check_task.cancel()
            self._health_check_task = None

    async def _health_check_loop(self) -> None:
        while not self._closed:
            await asyncio.sleep(self._failover_config.health_check_interval)
            try:
                await self.ping()
            except Exception:
                pass  # Health check failure handled by transport

    async def connect(self) -> None:
        await self.transport.connect()

    async def disconnect(self) -> None:
        self._closed = True
        self._stop_health_check()
        await self.transport.disconnect()

    async def request(self, method: str, params: Optional[Any] = None) -> Any:
        if self.status != ConnectionStatus.CONNECTED:
            raise RuntimeError(f"Connection not ready: {self.status}")

        self._request_id += 1
        message_id = self._request_id

        message: MCPMessage = {
            "jsonrpc": "2.0",
            "id": message_id,
            "method": method,
            "params": params,
        }

        future: asyncio.Future = asyncio.get_event_loop().create_future()
        timeout = asyncio.get_event_loop().call_later(
            self._retry_config.max_delay,
            lambda: self._handle_timeout(message_id, method)
        )
        self._pending[message_id] = future

        try:
            await self.transport.send(message)
            return await future
        except Exception:
            self._pending.pop(message_id, None)
            timeout.cancel()
            raise

    def _handle_timeout(self, message_id: Union[str, int], method: str) -> None:
        future = self._pending.pop(message_id, None)
        if future and not future.done():
            future.set_exception(TimeoutError(f"Request timeout: {method}"))

    async def notify(self, method: str, params: Optional[Any] = None) -> None:
        if self.status != ConnectionStatus.CONNECTED:
            raise RuntimeError(f"Connection not ready: {self.status}")

        message: MCPMessage = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        }
        await self.transport.send(message)

    async def stream(self, method: str, params: Optional[Any] = None) -> AsyncIterable[Any]:
        raise NotImplementedError("Streaming not yet implemented")

    async def close(self) -> None:
        await self.disconnect()

    def on_close(self, handler: Callable[[Optional[Exception]], None]) -> None:
        self._close_handlers.append(handler)

    def on_error(self, handler: Callable[[Exception], None]) -> None:
        self._error_handlers.append(handler)

    def _reject_all_pending(self, error: Exception) -> None:
        for future in self._pending.values():
            if not future.done():
                future.set_exception(error)
        self._pending.clear()

    def _handle_response(self, message: MCPMessage) -> None:
        future = self._pending.pop(message.get("id"), None)
        if not future or future.done():
            return

        if is_error_response(message):
            error = message.get("error", {})
            future.set_exception(create_mcp_error(
                message.get("id"),
                error.get("code", ERROR_CODES.INTERNAL_ERROR),
                error.get("message", "Unknown error"),
                error.get("data")
            ))
        else:
            future.set_result(message.get("result"))

    async def ping(self) -> None:
        await self.request("ping")


class ConnectionPool:
    def __init__(
        self,
        server_id: str,
        config: PoolConfig,
        transport_factory: Callable[[], Any],
        retry_config: RetryConfig,
        failover_config: FailoverConfig,
    ):
        self.server_id = server_id
        self.config = config
        self.transport_factory = transport_factory
        self.retry_config = retry_config
        self.failover_config = failover_config
        self._connections: List[Connection] = []
        self._available: List[Connection] = []
        self._acquiring = 0
        self._health_check_task: Optional[asyncio.Task] = None

    async def acquire(self) -> Connection:
        # Try available connections first
        while self._available:
            conn = self._available.pop()
            if conn.status == ConnectionStatus.CONNECTED:
                return conn
            await self._destroy_connection(conn)

        # Check pool limit
        if len(self._connections) >= self.config.max_connections:
            # Wait for available connection
            future = asyncio.get_event_loop().create_future()

            def on_available(c: Connection) -> None:
                if not future.done():
                    future.set_result(c)

            self._on_available_callbacks.append(on_available)
            try:
                return await asyncio.wait_for(future, timeout=self.config.acquire_timeout)
            except asyncio.TimeoutError:
                raise RuntimeError(f"Pool exhausted for {self.server_id}")
            finally:
                if on_available in self._on_available_callbacks:
                    self._on_available_callbacks.remove(on_available)

        # Create new connection
        self._acquiring += 1
        try:
            transport = await self.transport_factory()
            conn = await self._create_connection(transport)
            self._connections.append(conn)
            return conn
        finally:
            self._acquiring -= 1

    def release(self, connection: Connection) -> None:
        if connection.status == ConnectionStatus.CONNECTED and not connection._closed:
            self._available.append(connection)
            for cb in self._on_available_callbacks:
                cb(connection)
        else:
            asyncio.create_task(self._destroy_connection(connection))

    async def _create_connection(self, transport: Transport) -> Connection:
        conn = Connection(
            self.server_id,
            transport,
            {},
            self.retry_config,
            self.failover_config,
        )

        await conn.connect()

        # Initialize
        init_result = await conn.request("initialize", {
            "protocolVersion": "1.0",
            "capabilities": {},
            "clientInfo": {"name": "mcp-client", "version": "0.1.0"},
        })
        conn.capabilities = init_result.get("capabilities", {})
        await conn.notify("initialized", {})

        conn.on_close(lambda _: self._remove_connection(conn))
        conn.on_error(lambda e: None)  # Error handling

        return conn

    async def _destroy_connection(self, conn: Connection) -> None:
        if conn in self._connections:
            self._connections.remove(conn)
        if conn in self._available:
            self._available.remove(conn)
        await conn.close()

    def _remove_connection(self, conn: Connection) -> None:
        asyncio.create_task(self._destroy_connection(conn))

    async def initialize(self) -> None:
        for _ in range(self.config.min_connections):
            try:
                transport = await self.transport_factory()
                conn = await self._create_connection(transport)
                self._connections.append(conn)
                self._available.append(conn)
            except Exception:
                pass

        self._health_check_task = asyncio.create_task(self._health_check_loop())

    async def _health_check_loop(self) -> None:
        while True:
            await asyncio.sleep(self.config.health_check_interval)
            now = asyncio.get_event_loop().time()
            for conn in list(self._available):
                if now - conn.last_activity > self.config.idle_timeout:
                    try:
                        await conn.ping()
                    except Exception:
                        await self._destroy_connection(conn)

    async def shutdown(self) -> None:
        if self._health_check_task:
            self._health_check_task.cancel()
        for conn in self._connections:
            await conn.close()
        self._connections.clear()
        self._available.clear()

    def get_stats(self) -> Dict[str, int]:
        return {
            "total": len(self._connections),
            "available": len(self._available),
            "acquiring": self._acquiring,
        }

    _on_available_callbacks: List[Callable[[Connection], None]] = []


class ConnectionManager:
    def __init__(self):
        self._pools: Dict[str, ConnectionPool] = {}
        self._configs: Dict[str, ConnectionConfig] = {}
        self._contexts: Dict[str, McpContext] = {}
        self._context_counter = 0
        self._current_context: Optional[McpContext] = None

    async def connect(self, config: ConnectionConfig) -> Connection:
        server_id = config.server_id
        self._configs[server_id] = config

        pool = self._pools.get(server_id)
        if not pool:
            pool_config = PoolConfig()
            retry_config = config.retry or RetryConfig()
            failover_config = config.failover or FailoverConfig()

            async def transport_factory() -> Transport:
                if isinstance(config.transport, Transport):
                    return config.transport
                elif isinstance(config.transport, str):
                    return create_transport(TransportConfig(type=config.transport))
                else:
                    return create_transport(config.transport)

            pool = ConnectionPool(
                server_id,
                pool_config,
                transport_factory,
                retry_config,
                failover_config,
            )
            await pool.initialize()
            self._pools[server_id] = pool

        return await pool.acquire()

    def get_connection(self, server_id: str) -> Optional[Connection]:
        pool = self._pools.get(server_id)
        if not pool:
            return None
        stats = pool.get_stats()
        return None if stats["available"] > 0 else None

    async def get_or_create_connection(self, server_id: str) -> Connection:
        config = self._configs.get(server_id)
        if not config:
            raise ValueError(f"No configuration for server: {server_id}")
        return await self.connect(config)

    def on_connection_lost(self, server_id: str, handler: Callable[[Exception], None]) -> None:
        pass  # Event handling

    def enable_failover(self, config: FailoverConfig) -> None:
        for server_id, server_config in self._configs.items():
            self._configs[server_id] = ConnectionConfig(
                server_id=server_config.server_id,
                transport=server_config.transport,
                capabilities=server_config.capabilities,
                timeout=server_config.timeout,
                retry=server_config.retry,
                failover=config,
            )

    def create_context(self, parent: Optional[McpContext] = None) -> McpContext:
        self._context_counter += 1
        context = McpContext(
            request_id=f"ctx-{self._context_counter}",
            parent_request_id=parent.request_id if parent else None,
            metadata={**(parent.metadata if parent else {})},
            trace_id=parent.trace_id if parent else None,
            span_id=parent.span_id if parent else None,
            tenant_id=parent.tenant_id if parent else None,
            user_id=parent.user_id if parent else None,
        )
        self._contexts[context.request_id] = context
        return context

    def get_context(self, context_id: str) -> Optional[McpContext]:
        return self._contexts.get(context_id)

    def delete_context(self, context_id: str) -> None:
        self._contexts.pop(context_id, None)

    async def run_with_context(self, context: McpContext, fn: Callable[[], Any]) -> Any:
        previous = self._current_context
        self._current_context = context
        try:
            return await fn()
        finally:
            self._current_context = previous

    # High-level operations
    async def invoke_tool(self, server_id: str, tool: str, args: Dict[str, Any]) -> CallToolResult:
        conn = await self.get_or_create_connection(server_id)
        return await conn.request("tools/call", {"name": tool, "arguments": args})

    async def read_resource(self, server_id: str, uri: str) -> ReadResourceResult:
        conn = await self.get_or_create_connection(server_id)
        return await conn.request("resources/read", {"uri": uri})

    async def render_prompt(self, server_id: str, name: str, args: Dict[str, Any]) -> GetPromptResult:
        conn = await self.get_or_create_connection(server_id)
        return await conn.request("prompts/get", {"name": name, "arguments": args})

    async def list_tools(self, server_id: str) -> List[Tool]:
        conn = await self.get_or_create_connection(server_id)
        result = await conn.request("tools/list")
        return result.get("tools", [])

    async def list_resources(self, server_id: str) -> List[Resource]:
        conn = await self.get_or_create_connection(server_id)
        result = await conn.request("resources/list")
        return result.get("resources", [])

    async def list_prompts(self, server_id: str) -> List[Prompt]:
        conn = await self.get_or_create_connection(server_id)
        result = await conn.request("prompts/list")
        return result.get("prompts", [])

    async def shutdown(self) -> None:
        for pool in self._pools.values():
            await pool.shutdown()
        self._pools.clear()
        self._configs.clear()
        self._contexts.clear()


@dataclass
class McpClient:
    server_id: str
    capabilities: ServerCapabilities
    _connection: Connection
    _manager: ConnectionManager

    async def list_tools(self) -> List[Tool]:
        return await self._manager.list_tools(self.server_id)

    async def call_tool(self, name: str, args: Dict[str, Any]) -> CallToolResult:
        return await self._manager.invoke_tool(self.server_id, name, args)

    async def list_resources(self) -> List[Resource]:
        return await self._manager.list_resources(self.server_id)

    async def read_resource(self, uri: str) -> ReadResourceResult:
        return await self._manager.read_resource(self.server_id, uri)

    async def list_prompts(self) -> List[Prompt]:
        return await self._manager.list_prompts(self.server_id)

    async def get_prompt(self, name: str, args: Dict[str, Any]) -> GetPromptResult:
        return await self._manager.render_prompt(self.server_id, name, args)

    async def close(self) -> None:
        await self._connection.close()


async def connect_to_server(
    manager: ConnectionManager,
    config: ConnectionConfig,
) -> McpClient:
    connection = await manager.connect(config)
    return McpClient(
        server_id=config.server_id,
        capabilities=connection.capabilities,
        _connection=connection,
        _manager=manager,
    )


def create_connection_manager() -> ConnectionManager:
    return ConnectionManager()
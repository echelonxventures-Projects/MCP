"""
mcp_transports - MCP Transport Implementations for Python
"""

from __future__ import annotations

import asyncio
import json
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, AsyncIterable, Dict, List, Optional, Union
from enum import Enum

from mcp_types import (
    MCPMessage,
    MCPError,
    Transport,
    TransportType,
    TransportConfig,
    TransportCapabilities,
    StdioTransportConfig,
    HttpSseTransportConfig,
    WebSocketTransportConfig,
    GrpcTransportConfig,
    CustomTransportConfig,
    TransportError,
    TransportConnectionError,
    TransportTimeoutError,
    create_transport as _create_transport,
)


# ============================================================================
# Base Transport Class
# ============================================================================

class BaseTransport(ABC):
    def __init__(self, transport_type: TransportType, capabilities: TransportCapabilities):
        self.type = transport_type
        self.capabilities = capabilities
        self._connected = False
        self._connecting = False
        self._on_connect: Optional[callable] = None
        self._on_disconnect: Optional[callable] = None
        self._on_error: Optional[callable] = None

    @property
    def on_connect(self) -> Optional[callable]:
        return self._on_connect

    @on_connect.setter
    def on_connect(self, handler: callable) -> None:
        self._on_connect = handler

    @property
    def on_disconnect(self) -> Optional[callable]:
        return self._on_disconnect

    @on_disconnect.setter
    def on_disconnect(self, handler: callable) -> None:
        self._on_disconnect = handler

    @property
    def on_error(self) -> Optional[callable]:
        return self._on_error

    @on_error.setter
    def on_error(self, handler: callable) -> None:
        self._on_error = handler

    def _emit_connect(self) -> None:
        self._connected = True
        self._connecting = False
        if self._on_connect:
            self._on_connect()

    def _emit_disconnect(self, error: Optional[Exception] = None) -> None:
        self._connected = False
        self._connecting = False
        if self._on_disconnect:
            self._on_disconnect(error)

    def _emit_error(self, error: Exception) -> None:
        if self._on_error:
            self._on_error(error)

    @abstractmethod
    async def connect(self) -> None:
        pass

    @abstractmethod
    async def disconnect(self) -> None:
        pass

    @abstractmethod
    async def send(self, message: MCPMessage) -> None:
        pass

    @abstractmethod
    async def receive(self) -> AsyncIterable[MCPMessage]:
        pass


# ============================================================================
# Stdio Transport
# ============================================================================

class StdioTransport(BaseTransport):
    def __init__(self, config: StdioTransportConfig = None):
        config = config or StdioTransportConfig()
        super().__init__(
            TransportType.STDIO,
            TransportCapabilities(
                streaming=True,
                bidirectional=True,
                max_message_size=config.max_message_size or 10 * 1024 * 1024,
            ),
        )
        self._stdin = config.stdin
        self._stdout = config.stdout
        self._buffer = ""
        self._read_task: Optional[asyncio.Task] = None

    async def connect(self) -> None:
        if self._connected or self._connecting:
            return
        self._connecting = True

        # Start reading from stdin
        self._read_task = asyncio.create_task(self._read_loop())
        self._emit_connect()

    async def disconnect(self) -> None:
        if not self._connected:
            return
        if self._read_task:
            self._read_task.cancel()
        self._emit_disconnect()

    async def send(self, message: MCPMessage) -> None:
        if not self._connected:
            raise TransportConnectionError("stdio", "Not connected")

        line = json.dumps(message) + "\n"
        if self._stdout:
            self._stdout.write(line)
            await self._stdout.drain()
        else:
            import sys
            sys.stdout.write(line)
            sys.stdout.flush()

    async def receive(self) -> AsyncIterable[MCPMessage]:
        while self._connected:
            # In a real implementation, this would yield from a queue
            await asyncio.sleep(0.1)
            yield None  # Placeholder

    async def _read_loop(self) -> None:
        # Simplified - in reality would read from stdin
        pass


# ============================================================================
# WebSocket Transport
# ============================================================================

try:
    import websockets
    WEBSOCKETS_AVAILABLE = True
except ImportError:
    WEBSOCKETS_AVAILABLE = False

class WebSocketTransport(BaseTransport):
    def __init__(self, config: WebSocketTransportConfig):
        if not WEBSOCKETS_AVAILABLE:
            raise TransportError("websocket", "websockets package not installed. Install with: pip install websockets")

        super().__init__(
            TransportType.WEBSOCKET,
            TransportCapabilities(
                streaming=True,
                bidirectional=True,
                max_message_size=config.max_message_size or 16 * 1024 * 1024,
                compression=config.compression,
            ),
        )
        self._url = config.url
        self._protocols = config.protocols or ["mcp"]
        self._ws: Optional[websockets.WebSocketClientProtocol] = None
        self._message_queue: asyncio.Queue = asyncio.Queue()
        self._reconnect_attempts = 0
        self._max_reconnect_attempts = config.max_reconnect_attempts or 5
        self._reconnect_delay = config.reconnect_delay or 1.0
        self._should_reconnect = False

    async def connect(self) -> None:
        if self._connected or self._connecting:
            return
        self._connecting = True
        self._should_reconnect = True

        try:
            self._ws = await websockets.connect(self._url, subprotocols=self._protocols)
            self._reconnect_attempts = 0
            self._emit_connect()

            # Start receive loop
            asyncio.create_task(self._receive_loop())
        except Exception as e:
            self._connecting = False
            raise TransportConnectionError("websocket", f"Failed to connect: {e}", e)

    async def disconnect(self) -> None:
        self._should_reconnect = False
        if self._ws and not self._ws.closed:
            await self._ws.close()
        self._ws = None
        self._emit_disconnect()

    async def send(self, message: MCPMessage) -> None:
        if not self._ws or self._ws.closed:
            raise TransportConnectionError("websocket", "Not connected")
        await self._ws.send(json.dumps(message))

    async def receive(self) -> AsyncIterable[MCPMessage]:
        while self._connected or not self._message_queue.empty():
            try:
                message = await asyncio.wait_for(self._message_queue.get(), timeout=0.1)
                yield message
            except asyncio.TimeoutError:
                continue

    async def _receive_loop(self) -> None:
        try:
            async for message in self._ws:
                try:
                    parsed = json.loads(message)
                    await self._message_queue.put(parsed)
                except json.JSONDecodeError as e:
                    self._emit_error(TransportError("websocket", f"Failed to parse message: {e}", e))
        except websockets.exceptions.ConnectionClosed as e:
            self._emit_disconnect(TransportConnectionError("websocket", f"Connection closed: {e.reason}", e, {"code": e.code}))
            await self._schedule_reconnect()
        except Exception as e:
            self._emit_error(TransportConnectionError("websocket", "WebSocket error", e))

    async def _schedule_reconnect(self) -> None:
        if not self._should_reconnect or self._reconnect_attempts >= self._max_reconnect_attempts:
            return

        self._reconnect_attempts += 1
        delay = self._reconnect_delay * (2 ** (self._reconnect_attempts - 1))

        await asyncio.sleep(delay)

        if self._should_reconnect and not self._connected:
            try:
                await self.connect()
            except Exception:
                pass  # Will retry


# ============================================================================
# HTTP/SSE Transport
# ============================================================================

try:
    import aiohttp
    AIOHTTP_AVAILABLE = True
except ImportError:
    AIOHTTP_AVAILABLE = False

class HttpSseClientTransport(BaseTransport):
    def __init__(self, config: HttpSseTransportConfig):
        if not AIOHTTP_AVAILABLE:
            raise TransportError("http-sse", "aiohttp package not installed. Install with: pip install aiohttp")

        super().__init__(
            TransportType.HTTP_SSE,
            TransportCapabilities(
                streaming=True,
                bidirectional=False,
                max_message_size=config.max_message_size or 10 * 1024 * 1024,
            ),
        )
        self._base_url = config.base_url
        self._headers = config.headers or {}
        self._session: Optional[aiohttp.ClientSession] = None
        self._sse_task: Optional[asyncio.Task] = None
        self._message_queue: asyncio.Queue = asyncio.Queue()
        self._client_id = f"client-{uuid.uuid4().hex[:8]}"
        self._connected = False

    async def connect(self) -> None:
        if self._connected:
            return

        self._session = aiohttp.ClientSession()

        # Start SSE connection
        self._sse_task = asyncio.create_task(self._sse_loop())
        self._connected = True
        self._emit_connect()

    async def disconnect(self) -> None:
        if not self._connected:
            return

        if self._sse_task:
            self._sse_task.cancel()
        if self._session:
            await self._session.close()
        self._session = None
        self._connected = False
        self._emit_disconnect()

    async def send(self, message: MCPMessage) -> None:
        if not self._session:
            raise TransportConnectionError("http-sse", "Not connected")

        async with self._session.post(
            f"{self._base_url}/message",
            headers={"Content-Type": "application/json", **self._headers},
            json=message,
        ) as resp:
            if resp.status != 202:
                raise TransportError("http-sse", f"HTTP {resp.status}")

    async def receive(self) -> AsyncIterable[MCPMessage]:
        while self._connected or not self._message_queue.empty():
            try:
                message = await asyncio.wait_for(self._message_queue.get(), timeout=0.1)
                yield message
            except asyncio.TimeoutError:
                continue

    async def _sse_loop(self) -> None:
        try:
            async with self._session.get(
                f"{self._base_url}/events",
                headers={"Accept": "text/event-stream", **self._headers},
            ) as resp:
                async for line in resp.content:
                    line = line.decode("utf-8").strip()
                    if line.startswith("data: "):
                        try:
                            data = json.loads(line[6:])
                            await self._message_queue.put(data)
                        except json.JSONDecodeError as e:
                            self._emit_error(TransportError("http-sse", f"Failed to parse SSE data: {e}", e))
        except asyncio.CancelledError:
            pass
        except Exception as e:
            self._emit_error(TransportConnectionError("http-sse", f"SSE error: {e}", e))
            self._connected = False
            self._emit_disconnect(e)


# ============================================================================
# gRPC Transport (placeholder)
# ============================================================================

class GrpcTransport(BaseTransport):
    def __init__(self, config: GrpcTransportConfig):
        super().__init__(
            TransportType.GRPC,
            TransportCapabilities(
                streaming=True,
                bidirectional=True,
                max_message_size=config.max_message_size or 4 * 1024 * 1024,
            ),
        )
        self._config = config

    async def connect(self) -> None:
        raise TransportError("grpc", "gRPC transport not yet implemented. Requires grpcio and protobuf definitions.")

    async def disconnect(self) -> None:
        pass

    async def send(self, message: MCPMessage) -> None:
        raise TransportError("grpc", "gRPC transport not yet implemented")

    async def receive(self) -> AsyncIterable[MCPMessage]:
        raise TransportError("grpc", "gRPC transport not yet implemented")
        yield None


# ============================================================================
# Custom Transport
# ============================================================================

class CustomTransport(BaseTransport):
    def __init__(self, config: CustomTransportConfig):
        super().__init__(
            TransportType.CUSTOM,
            TransportCapabilities(
                streaming=config.capabilities.streaming if config.capabilities else True,
                bidirectional=config.capabilities.bidirectional if config.capabilities else True,
                max_message_size=config.capabilities.max_message_size if config.capabilities else 10 * 1024 * 1024,
            ),
        )
        self._handlers = config.handlers

    async def connect(self) -> None:
        await self._handlers.connect()
        self._emit_connect()

    async def disconnect(self) -> None:
        await self._handlers.disconnect()
        self._emit_disconnect()

    async def send(self, message: MCPMessage) -> None:
        await self._handlers.send(message)

    async def receive(self) -> AsyncIterable[MCPMessage]:
        async for message in self._handlers.receive():
            yield message


# ============================================================================
# Transport Factory
# ============================================================================

def create_transport(config: Union[TransportConfig, str]) -> BaseTransport:
    """Create a transport from configuration."""
    if isinstance(config, str):
        transport_type = config
        config = TransportConfig(type=transport_type)

    if isinstance(config, TransportConfig):
        if config.type == TransportType.STDIO:
            return StdioTransport(config)
        elif config.type == TransportType.WEBSOCKET:
            return WebSocketTransport(config)
        elif config.type == TransportType.HTTP_SSE:
            return HttpSseClientTransport(config)
        elif config.type == TransportType.GRPC:
            return GrpcTransport(config)
        elif config.type == TransportType.CUSTOM:
            return CustomTransport(config)

    raise TransportError("unknown", f"Unknown transport type: {config.type}")


# ============================================================================
# Exports
# ============================================================================

__all__ = [
    "BaseTransport",
    "StdioTransport",
    "WebSocketTransport",
    "HttpSseClientTransport",
    "GrpcTransport",
    "CustomTransport",
    "create_transport",
    "WEBSOCKETS_AVAILABLE",
    "AIOHTTP_AVAILABLE",
]
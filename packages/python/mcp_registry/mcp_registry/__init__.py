"""
mcp_registry - MCP Capability Registry & Service Discovery for Python
"""

from __future__ import annotations

import asyncio
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Callable, Awaitable
from enum import Enum

from mcp_types import (
    ServerCapabilities,
    ServerMetadata,
    EndpointConfig,
    TransportConfig,
)


# ============================================================================
# Type Definitions
# ============================================================================

@dataclass
class ServerRegistration:
    id: str
    name: str
    version: str
    transport: TransportConfig
    capabilities: ServerCapabilities
    metadata: ServerMetadata
    endpoints: List[EndpointConfig]
    tags: List[str] = field(default_factory=list)
    region: str = "default"
    tenant_id: Optional[str] = None
    registered_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    ttl: Optional[int] = None


@dataclass
class RegistrationResult:
    server_id: str
    registered: bool
    previous_version: Optional[ServerRegistration] = None


@dataclass
class DiscoveryCriteria:
    capabilities: Optional[Dict[str, Any]] = None
    tags: Optional[List[str]] = None
    version: Optional[str] = None
    region: Optional[str] = None
    tenant_id: Optional[str] = None
    name: Optional[str] = None
    healthy_only: bool = True


@dataclass
class HealthCheck:
    name: str
    status: str  # pass, warn, fail
    message: Optional[str] = None
    timestamp: float = field(default_factory=time.time)
    duration_ms: float = 0.0


@dataclass
class HealthInfo:
    status: str  # healthy, degraded, unhealthy
    last_check: float = field(default_factory=time.time)
    checks: List[HealthCheck] = field(default_factory=list)
    consecutive_failures: int = 0


@dataclass
class ServerStatus:
    REGISTERING = "registering"
    HEALTHY = "healthy"
    UNHEALTHY = "unhealthy"
    DRAINING = "draining"
    TERMINATED = "terminated"


@dataclass
class ServerInfo:
    id: str
    name: str
    version: str
    transport: TransportConfig
    capabilities: ServerCapabilities
    metadata: ServerMetadata
    endpoints: List[EndpointConfig]
    tags: List[str]
    region: str
    tenant_id: Optional[str]
    status: str
    health: HealthInfo
    registered_at: float
    updated_at: float


@dataclass
class HealthEvent:
    server_id: str
    previous_status: str
    current_status: str
    health: HealthInfo
    timestamp: float = field(default_factory=time.time)


@dataclass
class RegistryConfig:
    backend: str = "memory"
    options: Dict[str, Any] = field(default_factory=dict)
    health_check: Optional["HealthCheckConfig"] = None
    cache: Optional["CacheConfig"] = None


@dataclass
class HealthCheckConfig:
    enabled: bool = True
    interval: float = 30.0
    timeout: float = 5.0
    threshold: int = 3
    checks: List[Callable[[ServerRegistration], Awaitable[HealthCheck]]] = field(default_factory=list)


@dataclass
class CacheConfig:
    enabled: bool = True
    ttl: float = 5.0
    max_size: int = 1000


# ============================================================================
# Registry Interface
# ============================================================================

class CapabilityRegistry(ABC):
    @abstractmethod
    async def register(self, server: ServerRegistration) -> RegistrationResult:
        pass

    @abstractmethod
    async def unregister(self, server_id: str) -> None:
        pass

    @abstractmethod
    async def update(self, server_id: str, updates: Dict[str, Any]) -> ServerRegistration:
        pass

    @abstractmethod
    async def heartbeat(self, server_id: str) -> None:
        pass

    @abstractmethod
    async def discover(self, criteria: DiscoveryCriteria) -> List[ServerInfo]:
        pass

    @abstractmethod
    async def get(self, server_id: str) -> Optional[ServerInfo]:
        pass

    @abstractmethod
    async def list(self) -> List[ServerInfo]:
        pass

    @abstractmethod
    async def update_metadata(self, server_id: str, metadata: ServerMetadata) -> None:
        pass

    @abstractmethod
    async def add_tags(self, server_id: str, tags: List[str]) -> None:
        pass

    @abstractmethod
    async def remove_tags(self, server_id: str, tags: List[str]) -> None:
        pass

    @abstractmethod
    def on_server_registered(self, handler: Callable[[ServerInfo], Awaitable[None]]) -> None:
        pass

    @abstractmethod
    def on_server_unregistered(self, handler: Callable[[str], Awaitable[None]]) -> None:
        pass

    @abstractmethod
    def on_server_health_changed(self, handler: Callable[[HealthEvent], Awaitable[None]]) -> None:
        pass

    @abstractmethod
    def on_server_updated(self, handler: Callable[[ServerInfo], Awaitable[None]]) -> None:
        pass

    @abstractmethod
    async def start(self) -> None:
        pass

    @abstractmethod
    async def stop(self) -> None:
        pass

    @abstractmethod
    def is_healthy(self) -> bool:
        pass


# ============================================================================
# In-Memory Registry Implementation
# ============================================================================

class MemoryRegistry(CapabilityRegistry):
    def __init__(self, config: Optional[RegistryConfig] = None):
        self.config = config or RegistryConfig()
        if not self.config.health_check:
            self.config.health_check = HealthCheckConfig(checks=[default_health_check])
        if not self.config.cache:
            self.config.cache = CacheConfig()

        self._servers: Dict[str, ServerRegistration] = {}
        self._health_status: Dict[str, HealthInfo] = {}
        self._event_handlers: Dict[str, List[Callable]] = {
            "serverRegistered": [],
            "serverUnregistered": [],
            "serverHealthChanged": [],
            "serverUpdated": [],
        }
        self._health_check_task: Optional[asyncio.Task] = None
        self._cleanup_task: Optional[asyncio.Task] = None
        self._started = False
        self._cache: Dict[str, tuple[ServerRegistration, float]] = {}

    async def register(self, server: ServerRegistration) -> RegistrationResult:
        existing = self._servers.get(server.id)
        now = time.time()

        registration = ServerRegistration(
            id=server.id,
            name=server.name,
            version=server.version,
            transport=server.transport,
            capabilities=server.capabilities,
            metadata=server.metadata,
            endpoints=server.endpoints,
            tags=server.tags,
            region=server.region,
            tenant_id=server.tenant_id,
            registered_at=existing.registered_at if existing else now,
            updated_at=now,
            ttl=server.ttl,
        )

        self._servers[server.id] = registration
        self._health_status[server.id] = HealthInfo(
            status="healthy",
            last_check=now,
            checks=[],
            consecutive_failures=0,
        )

        self._invalidate_cache(server.id)
        await self._emit("serverRegistered", self._to_server_info(registration))

        return RegistrationResult(
            server_id=server.id,
            registered=existing is None,
            previous_version=existing,
        )

    async def unregister(self, server_id: str) -> None:
        server = self._servers.pop(server_id, None)
        if not server:
            return

        self._health_status.pop(server_id, None)
        self._invalidate_cache(server_id)
        await self._emit("serverUnregistered", server_id)

    async def update(self, server_id: str, updates: Dict[str, Any]) -> ServerRegistration:
        existing = self._servers.get(server_id)
        if not existing:
            raise ValueError(f"Server not found: {server_id}")

        updated = ServerRegistration(
            id=server_id,
            name=updates.get("name", existing.name),
            version=updates.get("version", existing.version),
            transport=updates.get("transport", existing.transport),
            capabilities=updates.get("capabilities", existing.capabilities),
            metadata=updates.get("metadata", existing.metadata),
            endpoints=updates.get("endpoints", existing.endpoints),
            tags=updates.get("tags", existing.tags),
            region=updates.get("region", existing.region),
            tenant_id=updates.get("tenant_id", existing.tenant_id),
            registered_at=existing.registered_at,
            updated_at=time.time(),
            ttl=updates.get("ttl", existing.ttl),
        )

        self._servers[server_id] = updated
        self._invalidate_cache(server_id)
        await self._emit("serverUpdated", self._to_server_info(updated))

        return updated

    async def heartbeat(self, server_id: str) -> None:
        server = self._servers.get(server_id)
        if not server:
            raise ValueError(f"Server not found: {server_id}")

        server.metadata = {**server.metadata, "lastHeartbeat": time.time()}
        server.updated_at = time.time()
        self._invalidate_cache(server_id)

    async def discover(self, criteria: DiscoveryCriteria) -> List[ServerInfo]:
        results = []

        for server in self._servers.values():
            if criteria.name and server.name != criteria.name and not server.name.startswith(criteria.name):
                continue

            if criteria.tags and not all(tag in server.tags for tag in criteria.tags):
                continue

            if criteria.region and server.region != criteria.region:
                continue

            if criteria.tenant_id and server.tenant_id != criteria.tenant_id:
                continue

            if criteria.version and not self._match_version(server.version, criteria.version):
                continue

            if criteria.capabilities and not self._match_capabilities(server.capabilities, criteria.capabilities):
                continue

            if criteria.healthy_only:
                health = self._health_status.get(server.id)
                if health and health.status != "healthy":
                    continue

            results.append(self._to_server_info(server))

        return results

    async def get(self, server_id: str) -> Optional[ServerInfo]:
        # Check cache
        if self.config.cache and self.config.cache.enabled:
            cached = self._cache.get(server_id)
            if cached and time.time() - cached[1] < self.config.cache.ttl:
                return self._to_server_info(cached[0])

        server = self._servers.get(server_id)
        if not server:
            return None

        info = self._to_server_info(server)
        self._update_cache(server)
        return info

    async def list(self) -> List[ServerInfo]:
        return [self._to_server_info(s) for s in self._servers.values()]

    async def update_metadata(self, server_id: str, metadata: ServerMetadata) -> None:
        server = self._servers.get(server_id)
        if not server:
            raise ValueError(f"Server not found: {server_id}")

        server.metadata = {**server.metadata, **metadata}
        server.updated_at = time.time()
        self._invalidate_cache(server_id)
        await self._emit("serverUpdated", self._to_server_info(server))

    async def add_tags(self, server_id: str, tags: List[str]) -> None:
        server = self._servers.get(server_id)
        if not server:
            raise ValueError(f"Server not found: {server_id}")

        server.tags = list(set(server.tags + tags))
        server.updated_at = time.time()
        self._invalidate_cache(server_id)
        await self._emit("serverUpdated", self._to_server_info(server))

    async def remove_tags(self, server_id: str, tags: List[str]) -> None:
        server = self._servers.get(server_id)
        if not server:
            raise ValueError(f"Server not found: {server_id}")

        server.tags = [t for t in server.tags if t not in tags]
        server.updated_at = time.time()
        self._invalidate_cache(server_id)
        await self._emit("serverUpdated", self._to_server_info(server))

    def on_server_registered(self, handler: Callable[[ServerInfo], Awaitable[None]]) -> None:
        self._event_handlers["serverRegistered"].append(handler)

    def on_server_unregistered(self, handler: Callable[[str], Awaitable[None]]) -> None:
        self._event_handlers["serverUnregistered"].append(handler)

    def on_server_health_changed(self, handler: Callable[[HealthEvent], Awaitable[None]]) -> None:
        self._event_handlers["serverHealthChanged"].append(handler)

    def on_server_updated(self, handler: Callable[[ServerInfo], Awaitable[None]]) -> None:
        self._event_handlers["serverUpdated"].append(handler)

    async def start(self) -> None:
        if self._started:
            return
        self._started = True

        if self.config.health_check and self.config.health_check.enabled:
            self._health_check_task = asyncio.create_task(self._health_check_loop())

        self._cleanup_task = asyncio.create_task(self._cleanup_loop())

    async def stop(self) -> None:
        if not self._started:
            return
        self._started = False

        if self._health_check_task:
            self._health_check_task.cancel()
        if self._cleanup_task:
            self._cleanup_task.cancel()

    def is_healthy(self) -> bool:
        return self._started

    def _to_server_info(self, server: ServerRegistration) -> ServerInfo:
        health = self._health_status.get(server.id, HealthInfo(
            status="healthy",
            last_check=time.time(),
            checks=[],
            consecutive_failures=0,
        ))

        return ServerInfo(
            id=server.id,
            name=server.name,
            version=server.version,
            transport=server.transport,
            capabilities=server.capabilities,
            metadata=server.metadata,
            endpoints=server.endpoints,
            tags=server.tags,
            region=server.region,
            tenant_id=server.tenant_id,
            status=self._compute_status(server, health),
            health=health,
            registered_at=server.registered_at,
            updated_at=server.updated_at,
        )

    def _compute_status(self, server: ServerRegistration, health: HealthInfo) -> str:
        if health.status == "unhealthy":
            return ServerStatus.UNHEALTHY
        if health.status == "degraded":
            return ServerStatus.UNHEALTHY
        return ServerStatus.HEALTHY

    def _match_version(self, version: str, range_str: str) -> bool:
        if range_str in ("*", "latest"):
            return True
        if range_str.startswith("^") or range_str.startswith("~"):
            v_parts = version.split(".")
            r_parts = range_str[1:].split(".")
            if range_str.startswith("^"):
                return v_parts[0] == r_parts[0]
            return v_parts[0] == r_parts[0] and v_parts[1] == r_parts[1]
        return version == range_str

    def _match_capabilities(self, server_caps: ServerCapabilities, required: Dict[str, Any]) -> bool:
        for key, value in required.items():
            server_value = server_caps.get(key)
            if not server_value:
                return False
            if server_value != value:
                return False
        return True

    def _update_cache(self, server: ServerRegistration) -> None:
        if self.config.cache and self.config.cache.enabled:
            if len(self._cache) >= self.config.cache.max_size:
                # Remove oldest
                oldest = min(self._cache.items(), key=lambda x: x[1][1])
                self._cache.pop(oldest[0])
            self._cache[server.id] = (server, time.time())

    def _invalidate_cache(self, server_id: str) -> None:
        self._cache.pop(server_id, None)

    async def _emit(self, event: str, data: Any) -> None:
        for handler in self._event_handlers.get(event, []):
            try:
                await handler(data)
            except Exception:
                pass  # Log error in production

    async def _health_check_loop(self) -> None:
        interval = self.config.health_check.interval
        checks = self.config.health_check.checks
        threshold = self.config.health_check.threshold

        while self._started:
            await asyncio.sleep(interval)

            for server_id, server in list(self._servers.items()):
                try:
                    health_results = await asyncio.gather(
                        *[check(server) for check in checks],
                        return_exceptions=True
                    )

                    failed = [h for h in health_results if isinstance(h, HealthCheck) and h.status == "fail"]
                    health = self._health_status.get(server_id, HealthInfo(
                        status="healthy",
                        last_check=time.time(),
                        checks=[],
                        consecutive_failures=0,
                    ))

                    health.checks = [h for h in health_results if isinstance(h, HealthCheck)]
                    health.last_check = time.time()

                    prev_status = health.status
                    if failed:
                        health.consecutive_failures += 1
                        health.status = "unhealthy" if health.consecutive_failures >= threshold else "degraded"
                    else:
                        health.consecutive_failures = 0
                        health.status = "healthy"

                    if health.status != prev_status:
                        await self._emit("serverHealthChanged", HealthEvent(
                            server_id=server_id,
                            previous_status=self._compute_status(server, HealthInfo(status=prev_status, last_check=0, checks=[], consecutive_failures=0)),
                            current_status=self._compute_status(server, health),
                            health=health,
                        ))
                except Exception:
                    # Health check itself failed
                    health = self._health_status.get(server_id, HealthInfo(
                        status="healthy", last_check=time.time(), checks=[], consecutive_failures=0
                    ))
                    health.consecutive_failures += 1
                    if health.consecutive_failures >= threshold:
                        health.status = "unhealthy"

    async def _cleanup_loop(self) -> None:
        while self._started:
            await asyncio.sleep(60)
            now = time.time()

            for server_id, server in list(self._servers.items()):
                if server.ttl:
                    age = now - server.updated_at
                    if age > server.ttl:
                        await self.unregister(server_id)

            # Clean cache
            if self.config.cache and self.config.cache.enabled:
                expired = [k for k, (_, t) in self._cache.items() if now - t > self.config.cache.ttl]
                for k in expired:
                    self._cache.pop(k, None)


async def default_health_check(server: ServerRegistration) -> HealthCheck:
    start = time.time()
    try:
        age = time.time() - server.updated_at
        if age > 120:
            return HealthCheck(
                name="staleness",
                status="fail",
                message=f"Server not updated for {int(age)}s",
                duration_ms=(time.time() - start) * 1000,
            )
        return HealthCheck(
            name="staleness",
            status="pass",
            message="Server recently updated",
            duration_ms=(time.time() - start) * 1000,
        )
    except Exception as e:
        return HealthCheck(
            name="staleness",
            status="fail",
            message=f"Health check error: {e}",
            duration_ms=(time.time() - start) * 1000,
        )


# ============================================================================
# Redis Registry (Stub)
# ============================================================================

class RedisRegistry(CapabilityRegistry):
    def __init__(self, config: Optional[RegistryConfig] = None):
        self.config = config or RegistryConfig()

    async def register(self, server: ServerRegistration) -> RegistrationResult:
        raise NotImplementedError("Redis registry not yet implemented")

    async def unregister(self, server_id: str) -> None:
        raise NotImplementedError("Redis registry not yet implemented")

    async def update(self, server_id: str, updates: Dict[str, Any]) -> ServerRegistration:
        raise NotImplementedError("Redis registry not yet implemented")

    async def heartbeat(self, server_id: str) -> None:
        raise NotImplementedError("Redis registry not yet implemented")

    async def discover(self, criteria: DiscoveryCriteria) -> List[ServerInfo]:
        raise NotImplementedError("Redis registry not yet implemented")

    async def get(self, server_id: str) -> Optional[ServerInfo]:
        raise NotImplementedError("Redis registry not yet implemented")

    async def list(self) -> List[ServerInfo]:
        raise NotImplementedError("Redis registry not yet implemented")

    async def update_metadata(self, server_id: str, metadata: ServerMetadata) -> None:
        raise NotImplementedError("Redis registry not yet implemented")

    async def add_tags(self, server_id: str, tags: List[str]) -> None:
        raise NotImplementedError("Redis registry not yet implemented")

    async def remove_tags(self, server_id: str, tags: List[str]) -> None:
        raise NotImplementedError("Redis registry not yet implemented")

    def on_server_registered(self, handler: Callable[[ServerInfo], Awaitable[None]]) -> None:
        pass

    def on_server_unregistered(self, handler: Callable[[str], Awaitable[None]]) -> None:
        pass

    def on_server_health_changed(self, handler: Callable[[HealthEvent], Awaitable[None]]) -> None:
        pass

    def on_server_updated(self, handler: Callable[[ServerInfo], Awaitable[None]]) -> None:
        pass

    async def start(self) -> None:
        raise NotImplementedError("Redis registry not yet implemented")

    async def stop(self) -> None:
        raise NotImplementedError("Redis registry not yet implemented")

    def is_healthy(self) -> bool:
        return False


# ============================================================================
# Factory Function
# ============================================================================

def create_registry(config: Optional[RegistryConfig] = None) -> CapabilityRegistry:
    config = config or RegistryConfig()
    backend = config.backend

    if backend == "memory":
        return MemoryRegistry(config)
    elif backend == "redis":
        return RedisRegistry(config)
    else:
        raise ValueError(f"Unknown registry backend: {backend}")


__all__ = [
    "CapabilityRegistry",
    "ServerRegistration",
    "RegistrationResult",
    "DiscoveryCriteria",
    "ServerInfo",
    "ServerStatus",
    "HealthInfo",
    "HealthCheck",
    "HealthEvent",
    "RegistryConfig",
    "HealthCheckConfig",
    "CacheConfig",
    "MemoryRegistry",
    "RedisRegistry",
    "create_registry",
    "default_health_check",
]
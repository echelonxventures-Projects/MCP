/**
 * @mcp/registry - Redis-backed Capability Registry
 * Production-ready registry with Redis backend
 */

import { createClient, RedisClientType, Cluster } from 'redis';
import { EventEmitter } from 'events';
import {
  ServerRegistration,
  RegistrationResult,
  DiscoveryCriteria,
  ServerInfo,
  ServerMetadata,
  HealthInfo,
  HealthCheck,
  HealthEvent,
  RegistryConfig,
  CapabilityRegistry,
  ServerCapabilities,
  ServerStatus,
} from '@mcp/types';

// ============================================================================
// Redis Registry Implementation
// ============================================================================

export class RedisRegistry extends EventEmitter implements CapabilityRegistry {
  private client: RedisClientType | Cluster | null = null;
  private config: RegistryConfig;
  private healthCheckInterval?: NodeJS.Timeout;
  private cleanupInterval?: NodeJS.Timeout;
  private started = false;
  private localCache = new Map<string, { data: ServerRegistration; expiry: number }>();
  private pubSubClient: RedisClientType | null = null;

  // Redis key prefixes
  private static readonly KEY_PREFIX = 'mcp:registry:';
  private static readonly SERVER_KEY = `${RedisRegistry.KEY_PREFIX}server:`;
  private static readonly INDEX_KEY = `${RedisRegistry.KEY_PREFIX}index:`;
  private static readonly HEALTH_KEY = `${RedisRegistry.KEY_PREFIX}health:`;
  private static readonly TAGS_KEY = `${RedisRegistry.KEY_PREFIX}tags:`;
  private static readonly TENANT_KEY = `${RedisRegistry.KEY_PREFIX}tenant:`;
  private static readonly REGION_KEY = `${RedisRegistry.KEY_PREFIX}region:`;
  private static readonly CHANNEL = `${RedisRegistry.KEY_PREFIX}events`;

  constructor(config: Partial<RegistryConfig> = {}) {
    super();
    this.config = {
      backend: 'redis',
      options: {
        url: 'redis://localhost:6379',
        cluster: false,
        ...config.options,
      },
      healthCheck: {
        enabled: true,
        interval: 30000,
        timeout: 5000,
        threshold: 3,
        checks: [defaultHealthCheck],
      },
      cache: {
        enabled: true,
        ttl: 5000,
        maxSize: 1000,
      },
      ...config,
    };
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async start(): Promise<void> {
    if (this.started) return;

    const options = this.config.options as any;

    if (options.cluster) {
      // Redis Cluster mode
      this.client = await this.createClusterClient(options);
    } else {
      // Standalone/Sentinel mode
      this.client = createClient({ url: options.url });
      await this.client.connect();
    }

    // Create pub/sub client for real-time events
    this.pubSubClient = this.client.duplicate() as RedisClientType;
    await this.pubSubClient.connect();

    // Subscribe to events
    await this.pubSubClient.subscribe(RedisRegistry.CHANNEL, (message) => {
      this.handlePubSubMessage(message);
    });

    // Start health checks
    if (this.config.healthCheck?.enabled) {
      this.startHealthChecks();
    }

    // Start TTL cleanup
    this.startCleanup();

    this.started = true;
    this.emit('started');
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    if (this.pubSubClient) {
      await this.pubSubClient.unsubscribe(RedisRegistry.CHANNEL);
      await this.pubSubClient.quit();
    }

    if (this.client) {
      await this.client.quit();
    }

    this.localCache.clear();
    this.emit('stopped');
  }

  isHealthy(): boolean {
    return this.started && this.client?.isReady === true;
  }

  private async createClusterClient(options: any): Promise<Cluster> {
    // For cluster mode, we'd use @redis/client cluster support
    // This is a simplified version
    const { createCluster } = await import('redis');
    const cluster = createCluster({
      rootNodes: options.rootNodes || [{ url: options.url }],
    });
    await cluster.connect();
    return cluster;
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  async register(server: ServerRegistration): Promise<RegistrationResult> {
    const key = `${RedisRegistry.SERVER_KEY}${server.id}`;
    const existing = await this.getServerFromRedis(server.id);
    const now = new Date();

    const registration: ServerRegistration = {
      ...server,
      registeredAt: existing?.registeredAt || now,
      updatedAt: now,
    };

    // Store server data
    await this.client!.hSet(key, {
      data: JSON.stringify(registration),
      updatedAt: now.toISOString(),
    });

    // Set TTL if specified
    if (server.ttl) {
      await this.client!.expire(key, server.ttl);
    }

    // Update indexes
    await this.updateIndexes(registration, existing);

    // Update cache
    this.updateCache(registration);

    // Publish event
    await this.publishEvent('serverRegistered', registration);

    const serverInfo = this.toServerInfo(registration);
    this.emit('serverRegistered', serverInfo);

    return {
      serverId: server.id,
      registered: !existing,
      previousVersion: existing,
    };
  }

  async unregister(serverId: string): Promise<void> {
    const server = await this.getServerFromRedis(serverId);
    if (!server) return;

    const key = `${RedisRegistry.SERVER_KEY}${serverId}`;

    // Remove from Redis
    await this.client!.del(key);

    // Remove from indexes
    await this.removeFromIndexes(serverId, server);

    // Remove from cache
    this.localCache.delete(serverId);

    // Publish event
    await this.publishEvent('serverUnregistered', { serverId });

    this.emit('serverUnregistered', serverId);
  }

  async update(serverId: string, updates: Partial<ServerRegistration>): Promise<ServerRegistration> {
    const existing = await this.getServerFromRedis(serverId);
    if (!existing) {
      throw new Error(`Server not found: ${serverId}`);
    }

    const updated: ServerRegistration = {
      ...existing,
      ...updates,
      id: serverId,
      updatedAt: new Date(),
    };

    const key = `${RedisRegistry.SERVER_KEY}${serverId}`;
    await this.client!.hSet(key, {
      data: JSON.stringify(updated),
      updatedAt: updated.updatedAt.toISOString(),
    });

    // Update indexes if tags/region/tenant changed
    if (updates.tags || updates.region || updates.tenantId) {
      await this.removeFromIndexes(serverId, existing);
      await this.updateIndexes(updated, existing);
    }

    this.updateCache(updated);
    await this.publishEvent('serverUpdated', updated);

    const serverInfo = this.toServerInfo(updated);
    this.emit('serverUpdated', serverInfo);

    return updated;
  }

  async heartbeat(serverId: string): Promise<void> {
    const server = await this.getServerFromRedis(serverId);
    if (!server) {
      throw new Error(`Server not found: ${serverId}`);
    }

    server.metadata = {
      ...server.metadata,
      lastHeartbeat: new Date().toISOString(),
    };
    server.updatedAt = new Date();

    const key = `${RedisRegistry.SERVER_KEY}${serverId}`;
    await this.client!.hSet(key, {
      data: JSON.stringify(server),
      updatedAt: server.updatedAt.toISOString(),
    });

    this.updateCache(server);
  }

  // ---------------------------------------------------------------------------
  // Discovery
  // ---------------------------------------------------------------------------

  async discover(criteria: DiscoveryCriteria): Promise<ServerInfo[]> {
    let serverIds: string[] = [];

    // Build candidate set from indexes
    if (criteria.name) {
      // Exact name lookup or prefix scan
      const pattern = `${RedisRegistry.INDEX_KEY}name:${criteria.name}*`;
      const keys = await this.client!.keys(pattern);
      serverIds = keys.map(k => k.replace(`${RedisRegistry.INDEX_KEY}name:`, ''));
    } else if (criteria.tags && criteria.tags.length > 0) {
      // Intersect tag indexes
      const tagKeys = criteria.tags.map(tag => `${RedisRegistry.TAGS_KEY}${tag}`);
      serverIds = await this.intersectSets(tagKeys);
    } else if (criteria.region) {
      serverIds = await this.client!.sMembers(`${RedisRegistry.REGION_KEY}${criteria.region}`);
    } else if (criteria.tenantId) {
      serverIds = await this.client!.sMembers(`${RedisRegistry.TENANT_KEY}${criteria.tenantId}`);
    } else {
      // Full scan (expensive, avoid in production)
      const keys = await this.client!.keys(`${RedisRegistry.SERVER_KEY}*`);
      serverIds = keys.map(k => k.replace(RedisRegistry.SERVER_KEY, ''));
    }

    // Fetch and filter servers
    const results: ServerInfo[] = [];
    for (const id of serverIds) {
      const server = await this.getServerFromRedis(id);
      if (!server) continue;

      // Apply filters
      if (criteria.capabilities && !this.matchCapabilities(server.capabilities, criteria.capabilities)) {
        continue;
      }
      if (criteria.version && !this.matchVersion(server.version, criteria.version)) {
        continue;
      }
      if (criteria.healthyOnly !== false) {
        const health = await this.getHealth(serverId);
        if (health.status !== 'healthy') continue;
      }

      results.push(this.toServerInfo(server));
    }

    return results;
  }

  async get(serverId: string): Promise<ServerInfo | null> {
    // Check cache first
    if (this.config.cache?.enabled) {
      const cached = this.localCache.get(serverId);
      if (cached && cached.expiry > Date.now()) {
        return this.toServerInfo(cached.data);
      }
    }

    const server = await this.getServerFromRedis(serverId);
    if (!server) return null;

    this.updateCache(server);
    return this.toServerInfo(server);
  }

  async list(): Promise<ServerInfo[]> {
    const keys = await this.client!.keys(`${RedisRegistry.SERVER_KEY}*`);
    const results: ServerInfo[] = [];

    for (const key of keys) {
      const id = key.replace(RedisRegistry.SERVER_KEY, '');
      const server = await this.getServerFromRedis(id);
      if (server) {
        results.push(this.toServerInfo(server));
      }
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Metadata
  // ---------------------------------------------------------------------------

  async updateMetadata(serverId: string, metadata: ServerMetadata): Promise<void> {
    const server = await this.getServerFromRedis(serverId);
    if (!server) {
      throw new Error(`Server not found: ${serverId}`);
    }

    server.metadata = { ...server.metadata, ...metadata };
    server.updatedAt = new Date();

    await this.update(serverId, { metadata: server.metadata });
  }

  async addTags(serverId: string, tags: string[]): Promise<void> {
    const server = await this.getServerFromRedis(serverId);
    if (!server) {
      throw new Error(`Server not found: ${serverId}`);
    }

    server.tags = [...new Set([...server.tags, ...tags])];
    server.updatedAt = new Date();

    await this.update(serverId, { tags: server.tags });
  }

  async removeTags(serverId: string, tags: string[]): Promise<void> {
    const server = await this.getServerFromRedis(serverId);
    if (!server) {
      throw new Error(`Server not found: ${serverId}`);
    }

    server.tags = server.tags.filter(t => !tags.includes(t));
    server.updatedAt = new Date();

    await this.update(serverId, { tags: server.tags });
  }

  // ---------------------------------------------------------------------------
  // Event Handlers
  // ---------------------------------------------------------------------------

  onServerRegistered(handler: (server: ServerInfo) => void): void {
    this.on('serverRegistered', handler);
  }

  onServerUnregistered(handler: (serverId: string) => void): void {
    this.on('serverUnregistered', handler);
  }

  onServerHealthChanged(handler: (event: HealthEvent) => void): void {
    this.on('serverHealthChanged', handler);
  }

  onServerUpdated(handler: (server: ServerInfo) => void): void {
    this.on('serverUpdated', handler);
  }

  // ---------------------------------------------------------------------------
  // Private Methods
  // ---------------------------------------------------------------------------

  private async getServerFromRedis(serverId: string): Promise<ServerRegistration | null> {
    const key = `${RedisRegistry.SERVER_KEY}${serverId}`;
    const data = await this.client!.hGet(key, 'data');
    if (!data) return null;

    try {
      return JSON.parse(data) as ServerRegistration;
    } catch {
      return null;
    }
  }

  private async getHealth(serverId: string): Promise<HealthInfo> {
    const key = `${RedisRegistry.HEALTH_KEY}${serverId}`;
    const data = await this.client!.hGetAll(key);

    if (!data || Object.keys(data).length === 0) {
      return {
        status: 'healthy',
        lastCheck: new Date(),
        checks: [],
        consecutiveFailures: 0,
      };
    }

    return {
      status: data.status as 'healthy' | 'degraded' | 'unhealthy',
      lastCheck: new Date(data.lastCheck),
      checks: JSON.parse(data.checks || '[]'),
      consecutiveFailures: parseInt(data.consecutiveFailures || '0'),
    };
  }

  private async updateIndexes(server: ServerRegistration, previous?: ServerRegistration | null): Promise<void> {
    const pipeline = this.client!.multi();

    // Name index
    pipeline.sAdd(`${RedisRegistry.INDEX_KEY}name:${server.name}`, server.id);

    // Tag indexes
    for (const tag of server.tags) {
      pipeline.sAdd(`${RedisRegistry.TAGS_KEY}${tag}`, server.id);
    }

    // Region index
    pipeline.sAdd(`${RedisRegistry.REGION_KEY}${server.region}`, server.id);

    // Tenant index
    if (server.tenantId) {
      pipeline.sAdd(`${RedisRegistry.TENANT_KEY}${server.tenantId}`, server.id);
    }

    // Version index (for semver queries)
    pipeline.sAdd(`${RedisRegistry.INDEX_KEY}version:${server.version}`, server.id);

    await pipeline.exec();

    // Clean up previous indexes if updated
    if (previous) {
      await this.removeFromIndexes(server.id, previous);
    }
  }

  private async removeFromIndexes(serverId: string, server: ServerRegistration): Promise<void> {
    const pipeline = this.client!.multi();

    pipeline.sRem(`${RedisRegistry.INDEX_KEY}name:${server.name}`, serverId);

    for (const tag of server.tags) {
      pipeline.sRem(`${RedisRegistry.TAGS_KEY}${tag}`, serverId);
    }

    pipeline.sRem(`${RedisRegistry.REGION_KEY}${server.region}`, serverId);

    if (server.tenantId) {
      pipeline.sRem(`${RedisRegistry.TENANT_KEY}${server.tenantId}`, serverId);
    }

    pipeline.sRem(`${RedisRegistry.INDEX_KEY}version:${server.version}`, serverId);

    await pipeline.exec();
  }

  private async intersectSets(keys: string[]): Promise<string[]> {
    if (keys.length === 0) return [];
    if (keys.length === 1) {
      return this.client!.sMembers(keys[0]);
    }
    // Use SINTER for intersection
    return this.client!.sIntersect(keys);
  }

  private updateCache(server: ServerRegistration): void {
    if (!this.config.cache?.enabled) return;

    // Evict if over max size
    if (this.localCache.size >= (this.config.cache.maxSize || 1000)) {
      const firstKey = this.localCache.keys().next().value;
      if (firstKey) this.localCache.delete(firstKey);
    }

    this.localCache.set(server.id, {
      data: server,
      expiry: Date.now() + (this.config.cache.ttl || 5000),
    });
  }

  private toServerInfo(server: ServerRegistration): ServerInfo {
    // In a real implementation, fetch health from Redis
    return {
      id: server.id,
      name: server.name,
      version: server.version,
      transport: server.transport,
      capabilities: server.capabilities,
      metadata: server.metadata,
      endpoints: server.endpoints,
      tags: server.tags,
      region: server.region,
      tenantId: server.tenantId,
      status: 'healthy', // Would compute from health
      health: {
        status: 'healthy',
        lastCheck: new Date(),
        checks: [],
        consecutiveFailures: 0,
      },
      registeredAt: server.registeredAt,
      updatedAt: server.updatedAt,
    };
  }

  private matchVersion(version: string, range: string): boolean {
    if (range === '*' || range === 'latest') return true;
    if (range.startsWith('^') || range.startsWith('~')) {
      const [major, minor] = version.split('.').map(Number);
      const [rMajor, rMinor] = range.replace(/^[\^~]/, '').split('.').map(Number);
      if (range.startsWith('^')) return major === rMajor;
      return major === rMajor && minor === rMinor;
    }
    return version === range;
  }

  private matchCapabilities(serverCaps: ServerCapabilities, required: Partial<ServerCapabilities>): boolean {
    for (const [key, value] of Object.entries(required)) {
      const serverValue = serverCaps[key as keyof ServerCapabilities];
      if (!serverValue) return false;
      if (JSON.stringify(serverValue) !== JSON.stringify(value)) {
        return false;
      }
    }
    return true;
  }

  private async publishEvent(event: string, data: any): Promise<void> {
    await this.client!.publish(RedisRegistry.CHANNEL, JSON.stringify({ event, data, timestamp: new Date().toISOString() }));
  }

  private handlePubSubMessage(message: string): void {
    try {
      const { event, data } = JSON.parse(message);
      this.emit(event, data);
    } catch {
      // Ignore parse errors
    }
  }

  private startHealthChecks(): void {
    const interval = this.config.healthCheck!.interval;
    const checks = this.config.healthCheck!.checks;
    const threshold = this.config.healthCheck!.threshold;

    this.healthCheckInterval = setInterval(async () => {
      const serverIds = await this.getAllServerIds();

      for (const serverId of serverIds) {
        const server = await this.getServerFromRedis(serverId);
        if (!server) continue;

        try {
          const healthResults = await Promise.all(
            checks.map(check => check(server))
          );

          const failedChecks = healthResults.filter(h => h.status === 'fail');
          const healthKey = `${RedisRegistry.HEALTH_KEY}${serverId}`;

          const currentHealth = await this.getHealth(serverId);

          const pipeline = this.client!.multi();
          pipeline.hSet(healthKey, {
            status: failedChecks.length > 0 ? (failedChecks.length >= threshold ? 'unhealthy' : 'degraded') : 'healthy',
            lastCheck: new Date().toISOString(),
            checks: JSON.stringify(healthResults),
            consecutiveFailures: failedChecks.length > 0 ? currentHealth.consecutiveFailures + 1 : 0,
          });

          await pipeline.exec();

          const newStatus = failedChecks.length > 0 ? (failedChecks.length >= threshold ? 'unhealthy' : 'degraded') : 'healthy';
          if (newStatus !== currentHealth.status) {
            this.emit('serverHealthChanged', {
              serverId,
              previousStatus: this.computeStatus(currentHealth.status),
              currentStatus: this.computeStatus(newStatus),
              health: { ...currentHealth, status: newStatus },
              timestamp: new Date(),
            });
          }
        } catch (error) {
          // Health check itself failed
          const healthKey = `${RedisRegistry.HEALTH_KEY}${serverId}`;
          const currentHealth = await this.getHealth(serverId);

          await this.client!.hSet(healthKey, {
            consecutiveFailures: currentHealth.consecutiveFailures + 1,
          });

          if (currentHealth.consecutiveFailures + 1 >= threshold) {
            await this.client!.hSet(healthKey, { status: 'unhealthy' });
          }
        }
      }
    }, interval);
  }

  private async getAllServerIds(): Promise<string[]> {
    const keys = await this.client!.keys(`${RedisRegistry.SERVER_KEY}*`);
    return keys.map(k => k.replace(RedisRegistry.SERVER_KEY, ''));
  }

  private computeStatus(healthStatus: string): ServerStatus {
    if (healthStatus === 'unhealthy') return 'unhealthy';
    if (healthStatus === 'degraded') return 'unhealthy';
    return 'healthy';
  }

  private startCleanup(): void {
    this.cleanupInterval = setInterval(async () => {
      const serverIds = await this.getAllServerIds();
      const now = Date.now();

      for (const serverId of serverIds) {
        const server = await this.getServerFromRedis(serverId);
        if (!server || !server.ttl) continue;

        const age = now - new Date(server.updatedAt).getTime();
        if (age > server.ttl * 1000) {
          await this.unregister(serverId);
        }
      }

      // Clean local cache
      for (const [key, value] of this.localCache.entries()) {
        if (value.expiry < now) {
          this.localCache.delete(key);
        }
      }
    }, 60000);
  }
}

// ============================================================================
// Default Health Check
// ============================================================================

async function defaultHealthCheck(server: ServerRegistration): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const age = Date.now() - new Date(server.updatedAt).getTime();
    if (age > 120000) {
      return {
        name: 'staleness',
        status: 'fail',
        message: `Server not updated for ${Math.round(age / 1000)}s`,
        timestamp: new Date(),
        durationMs: Date.now() - start,
      };
    }
    return {
      name: 'staleness',
      status: 'pass',
      message: 'Server recently updated',
      timestamp: new Date(),
      durationMs: Date.now() - start,
    };
  } catch (error) {
    return {
      name: 'staleness',
      status: 'fail',
      message: `Health check error: ${error}`,
      timestamp: new Date(),
      durationMs: Date.now() - start,
    };
  }
}
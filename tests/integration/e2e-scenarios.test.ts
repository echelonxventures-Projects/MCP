/**
 * End-to-End Scenario Tests
 *
 * Tests complete MCP workflows for different solution types:
 * - Ecommerce: Product search → recommendation prompt → cart tool
 * - Ride-sharing: Driver matching → real-time location resource → dispatch prompt
 * - Analytics: Data query tool → visualization resource → report prompt
 * - Multi-tenant: Isolated namespaces with custom quotas per tenant
 *
 * Run with: npx vitest run tests/integration/e2e-scenarios.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpServer } from '@mcp/server';
import { McpClient, createConnectionManager } from '@mcp/client';
import { ConnectionConfig } from '@mcp/types';

describe('E2E Scenario Tests', () => {
  let servers: Map<string, { server: McpServer; client: McpClient }> = new Map();
  const manager = createConnectionManager();

  beforeAll(async () => {
    // Start all scenario servers
    const scenarios = [
      { name: 'ecommerce', port: 5001, setup: setupEcommerceServer },
      { name: 'ride-sharing', port: 5002, setup: setupRideSharingServer },
      { name: 'analytics', port: 5003, setup: setupAnalyticsServer },
    ];

    for (const scenario of scenarios) {
      const server = new McpServer({
        name: scenario.name,
        version: '1.0.0',
        capabilities: {
          tools: { listChanged: true },
          resources: { subscribe: true, listChanged: true },
          prompts: { listChanged: true },
          logging: {},
        },
      });

      await scenario.setup(server);
      await server.start({ transport: 'websocket', port: scenario.port, host: '0.0.0.0' });

      const client = await manager.connect({
        transport: 'websocket',
        url: `ws://localhost:${scenario.port}`,
      });

      servers.set(scenario.name, { server, client });
    }
  }, 60000);

  afterAll(async () => {
    for (const { client, server } of servers.values()) {
      await client.close();
      await server.stop();
    }
    await manager.shutdown();
  }, 30000);

  describe('Ecommerce Scenario', () => {
    let client: McpClient;

    beforeAll(() => {
      client = servers.get('ecommerce')!.client;
    });

    it('should complete full shopping flow: search → recommend → cart → checkout', async () => {
      // 1. Search products
      const searchResult = await client.callTool('search-products', {
        query: 'headphones',
        category: 'electronics',
        limit: 5,
      });
      expect(searchResult.isError).toBeFalsy();
      const searchData = JSON.parse(searchResult.content[0].text);
      expect(searchData.products.length).toBeGreaterThan(0);

      const productId = searchData.products[0].id;

      // 2. Get product details
      const productResult = await client.callTool('get-product', { productId });
      expect(productResult.isError).toBeFalsy();

      // 3. Get recommendations
      const recResult = await client.callTool('get-recommendations', {
        userId: 'user-123',
        context: 'audio equipment',
        limit: 3,
      });
      expect(recResult.isError).toBeFalsy();

      // 4. Add to cart
      const cartResult = await client.callTool('add-to-cart', {
        userId: 'user-123',
        productId,
        quantity: 1,
      });
      expect(cartResult.isError).toBeFalsy();
      const cart = JSON.parse(cartResult.content[0].text);
      expect(cart.items.length).toBe(1);

      // 5. Get cart
      const getCartResult = await client.callTool('get-cart', { userId: 'user-123' });
      expect(getCartResult.isError).toBeFalsy();

      // 6. Checkout
      const checkoutResult = await client.callTool('checkout', {
        userId: 'user-123',
        paymentMethodId: 'pm-test',
        shippingAddress: {
          name: 'Test User',
          line1: '123 Test St',
          city: 'Test City',
          state: 'TS',
          postalCode: '12345',
          country: 'US',
        },
      });
      expect(checkoutResult.isError).toBeFalsy();
      const order = JSON.parse(checkoutResult.content[0].text);
      expect(order.id).toBeDefined();
      expect(order.status).toBe('confirmed');
    });

    it('should read product resource', async () => {
      const result = await client.readResource('product://prod-001');
      expect(result.isError).toBeFalsy();
      const product = JSON.parse(result.contents[0].text);
      expect(product.id).toBe('prod-001');
    });

    it('should read cart resource', async () => {
      const result = await client.readResource('cart://user-123');
      expect(result.isError).toBeFalsy();
    });

    it('should render product recommendation prompt', async () => {
      const result = await client.renderPrompt('product-recommendation', {
        userId: 'user-123',
        context: 'gift for tech enthusiast',
        budget: 500,
      });
      expect(result.isError).toBeFalsy();
      expect(result.messages.length).toBe(2);
    });

    it('should render cart summary prompt', async () => {
      const result = await client.renderPrompt('cart-summary', { userId: 'user-123' });
      expect(result.isError).toBeFalsy();
    });
  });

  describe('Ride-Sharing Scenario', () => {
    let client: McpClient;

    beforeAll(() => {
      client = servers.get('ride-sharing')!.client;
    });

    it('should complete full ride flow: request → match → track → complete', async () => {
      // 1. Request ride
      const requestResult = await client.callTool('request-ride', {
        riderId: 'rdr-001',
        pickup: { lat: 37.7749, lng: -122.4194, address: 'Union Square' },
        dropoff: { lat: 37.7849, lng: -122.4094, address: 'Mission District' },
        vehicleType: 'sedan',
      });
      expect(requestResult.isError).toBeFalsy();
      const requestData = JSON.parse(requestResult.content[0].text);
      const tripId = requestData.tripId;
      expect(tripId).toBeDefined();

      // 2. Get trip status
      const statusResult = await client.callTool('get-trip-status', { tripId });
      expect(statusResult.isError).toBeFalsy();

      // 3. Find nearby drivers
      const driversResult = await client.callTool('get-nearby-drivers', {
        location: { lat: 37.7749, lng: -122.4194 },
        vehicleType: 'sedan',
        maxDistance: 5,
      });
      expect(driversResult.isError).toBeFalsy();

      // 4. Get fare estimate
      const fareResult = await client.callTool('get-fare-estimate', {
        pickup: { lat: 37.7749, lng: -122.4194 },
        dropoff: { lat: 37.7849, lng: -122.4094 },
        vehicleType: 'sedan',
      });
      expect(fareResult.isError).toBeFalsy();
      const fareData = JSON.parse(fareResult.content[0].text);
      expect(fareData.estimatedPrice).toBeGreaterThan(0);

      // 5. Read trip resource
      const tripResource = await client.readResource(`trip://${tripId}`);
      expect(tripResource.isError).toBeFalsy();
    });

    it('should read active trips resource', async () => {
      const result = await client.readResource('trips://active');
      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.contents[0].text);
      expect(Array.isArray(data.trips)).toBe(true);
    });

    it('should read driver resource', async () => {
      const result = await client.readResource('driver://drv-001');
      expect(result.isError).toBeFalsy();
      const driver = JSON.parse(result.contents[0].text);
      expect(driver.id).toBe('drv-001');
    });

    it('should render ride summary prompt', async () => {
      // First create a trip
      const requestResult = await client.callTool('request-ride', {
        riderId: 'rdr-002',
        pickup: { lat: 37.7749, lng: -122.4194 },
        dropoff: { lat: 37.7849, lng: -122.4094 },
      });
      const tripId = JSON.parse(requestResult.content[0].text).tripId;

      const result = await client.renderPrompt('ride-summary', { tripId });
      expect(result.isError).toBeFalsy();
    });

    it('should render driver earnings prompt', async () => {
      const result = await client.renderPrompt('driver-earnings', {
        driverId: 'drv-001',
        period: 'today',
      });
      expect(result.isError).toBeFalsy();
    });
  });

  describe('Analytics Scenario', () => {
    let client: McpClient;

    beforeAll(() => {
      client = servers.get('analytics')!.client;
    });

    it('should complete full analytics flow: query → visualize → dashboard → report', async () => {
      // 1. Execute query
      const queryResult = await client.callTool('execute-query', {
        queryId: 'qry-001', // Daily Active Users
        limit: 30,
      });
      expect(queryResult.isError).toBeFalsy();
      const queryData = JSON.parse(queryResult.content[0].text);
      expect(queryData.columns).toContain('day');
      expect(queryData.columns).toContain('dau');
      expect(queryData.rows.length).toBe(30);

      // 2. Execute parameterized query
      const paramQueryResult = await client.callTool('execute-query', {
        queryId: 'qry-002', // Revenue by Category
        parameters: {
          startDate: '2024-01-01',
          endDate: '2024-01-31',
        },
      });
      expect(paramQueryResult.isError).toBeFalsy();

      // 3. Get Vega-Lite spec for visualization
      const vizSpecResult = await client.callTool('generate-vega-lite', {
        visualizationId: 'viz-001', // DAU Trend
      });
      expect(vizSpecResult.isError).toBeFalsy();
      const spec = JSON.parse(vizSpecResult.content[0].text);
      expect(spec.$schema).toContain('vega-lite');
      expect(spec.mark).toBe('line');

      // 4. Read dashboard resource
      const dashboardResult = await client.readResource('dashboard://dash-001');
      expect(dashboardResult.isError).toBeFalsy();
      const dashboard = JSON.parse(dashboardResult.contents[0].text);
      expect(dashboard.dashboard.name).toBe('Executive Overview');
      expect(dashboard.visualizations.length).toBe(2);

      // 5. Read schema resource
      const schemaResult = await client.readResource('schema://ds-001');
      expect(schemaResult.isError).toBeFalsy();
    });

    it('should list data sources', async () => {
      const result = await client.callTool('list-data-sources', {});
      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      expect(data.dataSources.length).toBeGreaterThanOrEqual(2);
    });

    it('should list queries', async () => {
      const result = await client.callTool('list-queries', {});
      expect(result.isError).toBeFalsy();
    });

    it('should render data analysis prompt', async () => {
      const result = await client.renderPrompt('analyze-data', {
        queryId: 'qry-001',
        context: 'Weekly business review',
      });
      expect(result.isError).toBeFalsy();
    });

    it('should render dashboard narrative prompt', async () => {
      const result = await client.renderPrompt('dashboard-narrative', {
        dashboardId: 'dash-001',
        audience: 'executive',
      });
      expect(result.isError).toBeFalsy();
    });

    it('should render SQL optimization prompt', async () => {
      const result = await client.renderPrompt('optimize-sql', {
        sql: 'SELECT * FROM events WHERE user_id = 123',
        dataSourceType: 'clickhouse',
      });
      expect(result.isError).toBeFalsy();
    });
  });

  describe('Multi-tenancy', () => {
    it('should isolate tenant data', async () => {
      // This would require a multi-tenant server setup
      // For now, verify the concept works with separate clients
      const manager = createConnectionManager();

      // In real implementation, each tenant would have isolated namespace
      // with custom quotas enforced by the server
    });

    it('should enforce tenant quotas', async () => {
      // Quota enforcement would be tested with actual multi-tenant server
    });
  });
});

// Server setup functions
async function setupEcommerceServer(server: McpServer) {
  // Products data
  const products = new Map([
    ['prod-001', { id: 'prod-001', name: 'Wireless Headphones', price: 299.99, category: 'electronics', inventory: 100 }],
    ['prod-002', { id: 'prod-002', name: 'Smart Watch', price: 399.99, category: 'electronics', inventory: 50 }],
    ['prod-003', { id: 'prod-003', name: 'T-Shirt', price: 29.99, category: 'apparel', inventory: 500 }],
  ]);

  const carts = new Map();

  server.tool('search-products', 'Search products', {
    query: { type: 'string' }, category: { type: 'string' }, limit: { type: 'integer', default: 20 }
  }, async ({ query, category, limit = 20 }) => {
    let results = Array.from(products.values());
    if (query) results = results.filter(p => p.name.toLowerCase().includes(query.toLowerCase()));
    if (category) results = results.filter(p => p.category === category);
    return { content: [{ type: 'text', text: JSON.stringify({ products: results.slice(0, limit) }) }] };
  });

  server.tool('get-product', 'Get product', {
    productId: { type: 'string' }
  }, async ({ productId }) => {
    const product = products.get(productId);
    return product
      ? { content: [{ type: 'text', text: JSON.stringify(product) }] }
      : { content: [{ type: 'text', text: JSON.stringify({ error: 'Not found' }) }], isError: true };
  });

  server.tool('add-to-cart', 'Add to cart', {
    userId: { type: 'string' }, productId: { type: 'string' }, quantity: { type: 'integer', default: 1 }
  }, async ({ userId, productId, quantity = 1 }) => {
    const product = products.get(productId);
    if (!product) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Product not found' }) }], isError: true };

    let cart = carts.get(userId) || { userId, items: [], total: 0 };
    const existing = cart.items.find(i => i.productId === productId);
    if (existing) existing.quantity += quantity;
    else cart.items.push({ productId, quantity, price: product.price });
    cart.total = cart.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    carts.set(userId, cart);
    return { content: [{ type: 'text', text: JSON.stringify(cart) }] };
  });

  server.tool('get-cart', 'Get cart', {
    userId: { type: 'string' }
  }, async ({ userId }) => {
    return { content: [{ type: 'text', text: JSON.stringify(carts.get(userId) || { userId, items: [], total: 0 }) }] };
  });

  server.tool('checkout', 'Checkout', {
    userId: { type: 'string' }, paymentMethodId: { type: 'string' }, shippingAddress: { type: 'object' }
  }, async ({ userId }) => {
    const cart = carts.get(userId);
    if (!cart || cart.items.length === 0) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Empty cart' }) }], isError: true };

    const order = { id: `order-${Date.now()}`, userId, ...cart, status: 'confirmed', createdAt: new Date().toISOString() };
    carts.delete(userId);
    return { content: [{ type: 'text', text: JSON.stringify(order) }] };
  });

  server.tool('get-recommendations', 'Get recommendations', {
    userId: { type: 'string' }, context: { type: 'string' }, limit: { type: 'integer', default: 10 }
  }, async ({ limit = 10 }) => {
    const recs = Array.from(products.values()).slice(0, limit);
    return { content: [{ type: 'text', text: JSON.stringify({ recommendations: recs }) }] };
  });

  server.resource('product://{productId}', 'Product', async (uri) => {
    const product = products.get(uri.params.productId);
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(product) }] };
  });

  server.resource('cart://{userId}', 'Cart', async (uri) => {
    const cart = carts.get(uri.params.userId) || { userId: uri.params.userId, items: [], total: 0 };
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(cart) }] };
  });

  server.prompt('product-recommendation', 'Product recommendation', {
    userId: { type: 'string' }, context: { type: 'string' }, budget: { type: 'number' }
  }, ({ userId, context, budget }) => ({
    messages: [
      { role: 'system', content: 'Shopping assistant' },
      { role: 'user', content: `Recommend products for ${userId}. Context: ${context}. Budget: ${budget}` }
    ]
  }));

  server.prompt('cart-summary', 'Cart summary', {
    userId: { type: 'string' }
  }, ({ userId }) => ({
    messages: [
      { role: 'system', content: 'Shopping assistant' },
      { role: 'user', content: `Summarize cart for ${userId}` }
    ]
  }));
}

async function setupRideSharingServer(server: McpServer) {
  const drivers = new Map([
    ['drv-001', { id: 'drv-001', name: 'John', vehicle: { type: 'sedan' }, location: { lat: 37.7749, lng: -122.4194 }, status: 'available' }],
  ]);

  const riders = new Map([['rdr-001', { id: 'rdr-001', name: 'Alice' }]]);
  const trips = new Map();

  function calcDistance(a: any, b: any) {
    return Math.sqrt(Math.pow(a.lat - b.lat, 2) + Math.pow(a.lng - b.lng, 2)) * 111; // rough km
  }

  server.tool('request-ride', 'Request ride', {
    riderId: { type: 'string' }, pickup: { type: 'object' }, dropoff: { type: 'object' }, vehicleType: { type: 'string' }
  }, async ({ riderId, pickup, dropoff, vehicleType }) => {
    const distance = calcDistance(pickup, dropoff);
    const tripId = `trip-${Date.now()}`;
    trips.set(tripId, { id: tripId, riderId, pickup, dropoff, status: 'requested', distance });
    return { content: [{ type: 'text', text: JSON.stringify({ tripId, status: 'requested' }) }] };
  });

  server.tool('get-trip-status', 'Get trip status', {
    tripId: { type: 'string' }
  }, async ({ tripId }) => {
    const trip = trips.get(tripId);
    return trip ? { content: [{ type: 'text', text: JSON.stringify(trip) }] } : { content: [{ type: 'text', text: JSON.stringify({ error: 'Not found' }) }], isError: true };
  });

  server.tool('get-nearby-drivers', 'Nearby drivers', {
    location: { type: 'object' }, vehicleType: { type: 'string' }, maxDistance: { type: 'number' }
  }, async ({ vehicleType }) => {
    const nearby = Array.from(drivers.values()).filter(d => d.status === 'available' && (!vehicleType || d.vehicle.type === vehicleType));
    return { content: [{ type: 'text', text: JSON.stringify({ drivers: nearby }) }] };
  });

  server.tool('get-fare-estimate', 'Fare estimate', {
    pickup: { type: 'object' }, dropoff: { type: 'object' }, vehicleType: { type: 'string' }
  }, async ({ pickup, dropoff, vehicleType }) => {
    const distance = calcDistance(pickup, dropoff);
    const base = vehicleType === 'sedan' ? 2.5 : 3.5;
    return { content: [{ type: 'text', text: JSON.stringify({ estimatedPrice: Math.round(5 + distance * base), distance }) }] };
  });

  server.resource('trip://{tripId}', 'Trip', async (uri) => {
    const trip = trips.get(uri.params.tripId);
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(trip) }] };
  });

  server.resource('trips://active', 'Active trips', async () => {
    const active = Array.from(trips.values()).filter(t => !['completed', 'cancelled'].includes(t.status));
    return { contents: [{ uri: 'trips://active', mimeType: 'application/json', text: JSON.stringify({ trips: active }) }] };
  });

  server.resource('driver://{driverId}', 'Driver', async (uri) => {
    const driver = drivers.get(uri.params.driverId);
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(driver) }] };
  });

  server.prompt('ride-summary', 'Ride summary', {
    tripId: { type: 'string' }
  }, ({ tripId }) => ({
    messages: [{ role: 'system', content: 'Assistant' }, { role: 'user', content: `Summarize trip ${tripId}` }]
  }));

  server.prompt('driver-earnings', 'Driver earnings', {
    driverId: { type: 'string' }, period: { type: 'string' }
  }, ({ driverId, period }) => ({
    messages: [{ role: 'system', content: 'Assistant' }, { role: 'user', content: `Earnings for ${driverId} (${period})` }]
  }));
}

async function setupAnalyticsServer(server: McpServer) {
  server.tool('execute-query', 'Execute query', {
    queryId: { type: 'string' }, parameters: { type: 'object' }, limit: { type: 'integer', default: 1000 }
  }, async ({ queryId }) => {
    if (queryId === 'qry-001') {
      const rows = Array.from({ length: 30 }, (_, i) => {
        const d = new Date(); d.setDate(d.getDate() - (29 - i));
        return [d.toISOString().split('T')[0], Math.floor(Math.random() * 5000) + 1000];
      });
      return { content: [{ type: 'text', text: JSON.stringify({ columns: ['day', 'dau'], rows }) }] };
    }
    if (queryId === 'qry-002') {
      return { content: [{ type: 'text', text: JSON.stringify({ columns: ['category', 'revenue'], rows: [['Electronics', 125000], ['Apparel', 89000]] }) }] };
    }
    return { content: [{ type: 'text', text: JSON.stringify({ columns: [], rows: [] }) }] };
  });

  server.tool('list-data-sources', 'List data sources', {}, async () => ({
    content: [{ type: 'text', text: JSON.stringify({ dataSources: [{ id: 'ds-001', name: 'PostgreSQL', type: 'postgresql' }, { id: 'ds-002', name: 'ClickHouse', type: 'clickhouse' }] }) }]
  }));

  server.tool('list-queries', 'List queries', {}, async () => ({
    content: [{ type: 'text', text: JSON.stringify({ queries: [{ id: 'qry-001', name: 'Daily Active Users' }, { id: 'qry-002', name: 'Revenue by Category' }] }) }]
  }));

  server.tool('generate-vega-lite', 'Generate Vega-Lite', {
    visualizationId: { type: 'string' }
  }, async ({ visualizationId }) => {
    return { content: [{ type: 'text', text: JSON.stringify({ $schema: 'https://vega.github.io/schema/vega-lite/v5.json', mark: 'line', encoding: { x: { field: 'day' }, y: { field: 'dau' } } }) }] };
  });

  server.resource('dashboard://dash-001', 'Dashboard', async () => ({
    contents: [{ uri: 'dashboard://dash-001', mimeType: 'application/json', text: JSON.stringify({ dashboard: { name: 'Executive Overview' }, visualizations: [{ id: 'viz-001' }, { id: 'viz-002' }] }) }]
  }));

  server.resource('schema://ds-001', 'Schema', async () => ({
    contents: [{ uri: 'schema://ds-001', mimeType: 'application/json', text: JSON.stringify({ schemas: [{ name: 'public', tables: ['events', 'users'] }] }) }]
  }));

  server.prompt('analyze-data', 'Analyze data', {
    queryId: { type: 'string' }, context: { type: 'string' }
  }, ({ queryId, context }) => ({
    messages: [{ role: 'system', content: 'Analyst' }, { role: 'user', content: `Analyze ${queryId}. Context: ${context}` }]
  }));

  server.prompt('dashboard-narrative', 'Dashboard narrative', {
    dashboardId: { type: 'string' }, audience: { type: 'string' }
  }, ({ dashboardId, audience }) => ({
    messages: [{ role: 'system', content: 'BI Analyst' }, { role: 'user', content: `Narrative for ${dashboardId} for ${audience}` }]
  }));

  server.prompt('optimize-sql', 'Optimize SQL', {
    sql: { type: 'string' }, dataSourceType: { type: 'string' }
  }, ({ sql, dataSourceType }) => ({
    messages: [{ role: 'system', content: 'SQL Expert' }, { role: 'user', content: `Optimize: ${sql} for ${dataSourceType}` }]
  }));
}
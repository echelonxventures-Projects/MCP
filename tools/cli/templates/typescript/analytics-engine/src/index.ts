/**
 * Analytics Engine MCP Server
 * Query builder, visualization resources, and report generation
 */

import { McpServer, tool, resource, prompt } from "@mcp/server";
import { z } from "zod";

// Type definitions
interface DataSource {
  id: string;
  name: string;
  type: "postgresql" | "clickhouse" | "bigquery" | "snowflake" | "csv";
  config: Record<string, unknown>;
  status: "connected" | "disconnected" | "error";
}

interface Query {
  id: string;
  name: string;
  sql: string;
  dataSourceId: string;
  parameters: QueryParameter[];
  createdAt: string;
  updatedAt: string;
}

interface QueryParameter {
  name: string;
  type: "string" | "number" | "boolean" | "date" | "array";
  required: boolean;
  default?: unknown;
  description?: string;
}

interface QueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  executionTime: number;
  dataSourceId: string;
}

interface Visualization {
  id: string;
  name: string;
  type: "line" | "bar" | "pie" | "scatter" | "heatmap" | "table" | "kpi";
  queryId: string;
  config: Record<string, unknown>;
  spec?: object; // Vega-Lite spec
}

interface Dashboard {
  id: string;
  name: string;
  description?: string;
  visualizations: string[]; // Visualization IDs
  layout: DashboardLayout[];
  createdAt: string;
  updatedAt: string;
}

interface DashboardLayout {
  visualizationId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Report {
  id: string;
  name: string;
  description?: string;
  queryIds: string[];
  visualizations: string[];
  schedule?: {
    cron: string;
    recipients: string[];
    format: "pdf" | "html" | "csv" | "json";
  };
  lastRun?: string;
  nextRun?: string;
}

// Mock data stores
const dataSources: Map<string, DataSource> = new Map();
const queries: Map<string, Query> = new Map();
const visualizations: Map<string, Visualization> = new Map();
const dashboards: Map<string, Dashboard> = new Map();
const reports: Map<string, Report> = new Map();

// Initialize sample data
function initializeSampleData() {
  // Sample data sources
  const sampleDataSources: DataSource[] = [
    {
      id: "ds-001",
      name: "Production PostgreSQL",
      type: "postgresql",
      config: { host: "localhost", port: 5432, database: "analytics" },
      status: "connected",
    },
    {
      id: "ds-002",
      name: "ClickHouse Analytics",
      type: "clickhouse",
      config: { host: "localhost", port: 8123, database: "events" },
      status: "connected",
    },
  ];

  for (const ds of sampleDataSources) {
    dataSources.set(ds.id, ds);
  }

  // Sample queries
  const sampleQueries: Query[] = [
    {
      id: "qry-001",
      name: "Daily Active Users",
      sql: `SELECT date_trunc('day', event_time) as day, count(DISTINCT user_id) as dau
            FROM events
            WHERE event_time >= NOW() - INTERVAL '30 days'
            GROUP BY 1 ORDER BY 1`,
      dataSourceId: "ds-002",
      parameters: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "qry-002",
      name: "Revenue by Product Category",
      sql: `SELECT category, SUM(amount) as revenue, COUNT(*) as orders
            FROM orders o
            JOIN products p ON o.product_id = p.id
            WHERE o.created_at >= $1 AND o.created_at <= $2
            GROUP BY 1 ORDER BY 2 DESC`,
      dataSourceId: "ds-001",
      parameters: [
        { name: "startDate", type: "date", required: true, description: "Start date" },
        { name: "endDate", type: "date", required: true, description: "End date" },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  for (const q of sampleQueries) {
    queries.set(q.id, q);
  }

  // Sample visualizations
  const sampleVisualizations: Visualization[] = [
    {
      id: "viz-001",
      name: "DAU Trend",
      type: "line",
      queryId: "qry-001",
      config: { x: "day", y: "dau", title: "Daily Active Users (30 days)" },
    },
    {
      id: "viz-002",
      name: "Revenue by Category",
      type: "bar",
      queryId: "qry-002",
      config: { x: "category", y: "revenue", title: "Revenue by Product Category" },
    },
  ];

  for (const v of sampleVisualizations) {
    visualizations.set(v.id, v);
  }

  // Sample dashboard
  const sampleDashboard: Dashboard = {
    id: "dash-001",
    name: "Executive Overview",
    description: "High-level business metrics",
    visualizations: ["viz-001", "viz-002"],
    layout: [
      { visualizationId: "viz-001", x: 0, y: 0, w: 12, h: 8 },
      { visualizationId: "viz-002", x: 0, y: 8, w: 12, h: 8 },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  dashboards.set(sampleDashboard.id, sampleDashboard);
}

initializeSampleData();

// Mock query executor
async function executeQuery(query: Query, params: Record<string, unknown>): Promise<QueryResult> {
  // In real implementation, connect to actual data source
  const startTime = Date.now();

  // Mock results based on query
  if (query.id === "qry-001") {
    const rows = Array.from({ length: 30 }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (29 - i));
      return [date.toISOString().split('T')[0], Math.floor(Math.random() * 5000) + 1000];
    });
    return {
      columns: ["day", "dau"],
      rows,
      rowCount: rows.length,
      executionTime: Date.now() - startTime,
      dataSourceId: query.dataSourceId,
    };
  }

  if (query.id === "qry-002") {
    const rows = [
      ["Electronics", 125000, 450],
      ["Apparel", 89000, 1200],
      ["Home", 67000, 890],
      ["Books", 23000, 2100],
    ];
    return {
      columns: ["category", "revenue", "orders"],
      rows,
      rowCount: rows.length,
      executionTime: Date.now() - startTime,
      dataSourceId: query.dataSourceId,
    };
  }

  return {
    columns: [],
    rows: [],
    rowCount: 0,
    executionTime: Date.now() - startTime,
    dataSourceId: query.dataSourceId,
  };
}

// Create MCP server
const server = new McpServer({
  name: "analytics-engine",
  version: "3.0.0",
  capabilities: {
    tools: { listChanged: true },
    resources: { subscribe: true, listChanged: true },
    prompts: { listChanged: true },
    logging: {},
  },
});

// ============================================
// TOOLS
// ============================================

// Execute query
server.tool(
  "execute-query",
  "Execute a SQL query against a data source",
  {
    queryId: z.string().describe("Query ID"),
    parameters: z.record(z.unknown()).optional().describe("Query parameters"),
    limit: z.number().int().positive().max(10000).optional().default(1000).describe("Row limit"),
  },
  async ({ queryId, parameters = {}, limit }) => {
    const query = queries.get(queryId);
    if (!query) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Query not found" }) }], isError: true };
    }

    // Validate required parameters
    for (const param of query.parameters) {
      if (param.required && !(param.name in parameters)) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: `Missing required parameter: ${param.name}` }) }],
          isError: true
        };
      }
    }

    const result = await executeQuery(query, parameters);

    // Apply limit
    if (result.rows.length > limit) {
      result.rows = result.rows.slice(0, limit);
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          queryId,
          columns: result.columns,
          rows: result.rows,
          rowCount: result.rowCount,
          executionTime: result.executionTime,
          limited: result.rowCount > limit,
        }, null, 2),
      }],
    };
  }
);

// Execute raw SQL
server.tool(
  "execute-sql",
  "Execute raw SQL against a data source",
  {
    dataSourceId: z.string().describe("Data source ID"),
    sql: z.string().describe("SQL query"),
    parameters: z.record(z.unknown()).optional().describe("Query parameters"),
    limit: z.number().int().positive().max(10000).optional().default(1000).describe("Row limit"),
  },
  async ({ dataSourceId, sql, parameters = {}, limit }) => {
    const ds = dataSources.get(dataSourceId);
    if (!ds) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Data source not found" }) }], isError: true };
    }

    // In real implementation, execute against actual data source
    const startTime = Date.now();
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          message: "Raw SQL execution not implemented in mock",
          sql,
          executionTime: Date.now() - startTime,
        }, null, 2),
      }],
    };
  }
);

// List data sources
server.tool(
  "list-data-sources",
  "List all configured data sources",
  {},
  async () => {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          dataSources: Array.from(dataSources.values()),
        }, null, 2),
      }],
    };
  }
);

// Create data source
server.tool(
  "create-data-source",
  "Create a new data source connection",
  {
    name: z.string().describe("Data source name"),
    type: z.enum(["postgresql", "clickhouse", "bigquery", "snowflake", "csv"]).describe("Data source type"),
    config: z.record(z.unknown()).describe("Connection configuration"),
  },
  async ({ name, type, config }) => {
    const id = `ds-${Date.now()}`;
    const dataSource: DataSource = {
      id,
      name,
      type,
      config,
      status: "disconnected",
    };
    dataSources.set(id, dataSource);
    return { content: [{ type: "text", text: JSON.stringify(dataSource, null, 2) }] };
  }
);

// Test data source connection
server.tool(
  "test-data-source",
  "Test data source connection",
  {
    dataSourceId: z.string().describe("Data source ID"),
  },
  async ({ dataSourceId }) => {
    const ds = dataSources.get(dataSourceId);
    if (!ds) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Data source not found" }) }], isError: true };
    }

    // Mock connection test
    ds.status = "connected";
    dataSources.set(dataSourceId, ds);

    return { content: [{ type: "text", text: JSON.stringify({ success: true, status: "connected" }, null, 2) }] };
  }
);

// Save query
server.tool(
  "save-query",
  "Save a query for reuse",
  {
    name: z.string().describe("Query name"),
    sql: z.string().describe("SQL query"),
    dataSourceId: z.string().describe("Data source ID"),
    parameters: z.array(z.object({
      name: z.string(),
      type: z.enum(["string", "number", "boolean", "date", "array"]),
      required: z.boolean(),
      default: z.unknown().optional(),
      description: z.string().optional(),
    })).optional().default([]).describe("Query parameters"),
  },
  async ({ name, sql, dataSourceId, parameters }) => {
    const id = `qry-${Date.now()}`;
    const query: Query = {
      id,
      name,
      sql,
      dataSourceId,
      parameters,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    queries.set(id, query);
    return { content: [{ type: "text", text: JSON.stringify(query, null, 2) }] };
  }
);

// List queries
server.tool(
  "list-queries",
  "List all saved queries",
  {},
  async () => {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          queries: Array.from(queries.values()),
        }, null, 2),
      }],
    };
  }
);

// Create visualization
server.tool(
  "create-visualization",
  "Create a visualization from query results",
  {
    name: z.string().describe("Visualization name"),
    type: z.enum(["line", "bar", "pie", "scatter", "heatmap", "table", "kpi"]).describe("Chart type"),
    queryId: z.string().describe("Query ID"),
    config: z.record(z.unknown()).describe("Visualization configuration"),
  },
  async ({ name, type, queryId, config }) => {
    const query = queries.get(queryId);
    if (!query) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Query not found" }) }], isError: true };
    }

    const id = `viz-${Date.now()}`;
    const visualization: Visualization = {
      id,
      name,
      type,
      queryId,
      config,
    };
    visualizations.set(id, visualization);
    return { content: [{ type: "text", text: JSON.stringify(visualization, null, 2) }] };
  }
);

// Generate Vega-Lite spec
server.tool(
  "generate-vega-lite",
  "Generate Vega-Lite specification for a visualization",
  {
    visualizationId: z.string().describe("Visualization ID"),
  },
  async ({ visualizationId }) => {
    const viz = visualizations.get(visualizationId);
    if (!viz) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Visualization not found" }) }], isError: true };
    }

    const query = queries.get(viz.queryId);
    if (!query) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Query not found" }) }], isError: true };
    }

    // Generate Vega-Lite spec based on visualization type
    const spec = generateVegaLiteSpec(viz, query);

    viz.spec = spec;
    visualizations.set(visualizationId, viz);

    return { content: [{ type: "text", text: JSON.stringify(spec, null, 2) }] };
  }
);

// Create dashboard
server.tool(
  "create-dashboard",
  "Create a dashboard with multiple visualizations",
  {
    name: z.string().describe("Dashboard name"),
    description: z.string().optional().describe("Dashboard description"),
    visualizations: z.array(z.string()).describe("Visualization IDs"),
    layout: z.array(z.object({
      visualizationId: z.string(),
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
    })).describe("Dashboard layout"),
  },
  async ({ name, description, visualizations: vizIds, layout }) => {
    const id = `dash-${Date.now()}`;
    const dashboard: Dashboard = {
      id,
      name,
      description,
      visualizations: vizIds,
      layout,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    dashboards.set(id, dashboard);
    return { content: [{ type: "text", text: JSON.stringify(dashboard, null, 2) }] };
  }
);

// Create report
server.tool(
  "create-report",
  "Create a scheduled report",
  {
    name: z.string().describe("Report name"),
    description: z.string().optional().describe("Report description"),
    queryIds: z.array(z.string()).describe("Query IDs to include"),
    visualizationIds: z.array(z.string()).describe("Visualization IDs to include"),
    schedule: z.object({
      cron: z.string().describe("Cron expression"),
      recipients: z.array(z.string()).describe("Email recipients"),
      format: z.enum(["pdf", "html", "csv", "json"]).describe("Output format"),
    }).optional().describe("Schedule configuration"),
  },
  async ({ name, description, queryIds, visualizationIds, schedule }) => {
    const id = `rpt-${Date.now()}`;
    const report: Report = {
      id,
      name,
      description,
      queryIds,
      visualizations: visualizationIds,
      schedule,
      nextRun: schedule ? calculateNextRun(schedule.cron) : undefined,
    };
    reports.set(id, report);
    return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
  }
);

// Generate report
server.tool(
  "generate-report",
  "Generate a report on demand",
  {
    reportId: z.string().describe("Report ID"),
    format: z.enum(["pdf", "html", "csv", "json"]).optional().default("html").describe("Output format"),
  },
  async ({ reportId, format = "html" }) => {
    const report = reports.get(reportId);
    if (!report) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Report not found" }) }], isError: true };
    }

    // Execute all queries
    const results = await Promise.all(
      report.queryIds.map(async (qid) => {
        const query = queries.get(qid);
        if (!query) return { queryId: qid, error: "Query not found" };
        const result = await executeQuery(query, {});
        return { queryId: qid, queryName: query.name, result };
      })
    );

    // Generate output based on format
    let output: string;
    if (format === "json") {
      output = JSON.stringify({ report, results, generatedAt: new Date().toISOString() }, null, 2);
    } else if (format === "csv") {
      output = results.map(r => {
        if ('error' in r) return `Error: ${r.error}`;
        return [r.queryName, ...r.result.columns.join(","), ...r.result.rows.map(row => row.join(","))].join("\n");
      }).join("\n\n");
    } else {
      // HTML format
      output = `<html><body><h1>${report.name}</h1><p>Generated: ${new Date().toISOString()}</p>${results.map(r => {
        if ('error' in r) return `<p>Error: ${r.error}</p>`;
        return `<h2>${r.queryName}</h2><table><tr>${r.result.columns.map(c => `<th>${c}</th>`).join("")}</tr>${r.result.rows.map(row => `<tr>${row.map(c => `<td>${c}</td>`).join("")}</tr>).join("")}</table>`;
      }).join("")}</body></html>`;
    }

    report.lastRun = new Date().toISOString();
    report.nextRun = report.schedule ? calculateNextRun(report.schedule.cron) : undefined;
    reports.set(reportId, report);

    return { content: [{ type: "text", text: output }] };
  }
);

// Get schema information
server.tool(
  "get-schema",
  "Get database schema information",
  {
    dataSourceId: z.string().describe("Data source ID"),
    schema: z.string().optional().describe("Schema name"),
    table: z.string().optional().describe("Table name"),
  },
  async ({ dataSourceId, schema, table }) => {
    const ds = dataSources.get(dataSourceId);
    if (!ds) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Data source not found" }) }], isError: true };
    }

    // Mock schema info
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          dataSource: ds.name,
          schemas: [
            {
              name: schema || "public",
              tables: [
                { name: "events", columns: [{ name: "id", type: "bigint" }, { name: "user_id", type: "bigint" }, { name: "event_time", type: "timestamp" }, { name: "event_type", type: "varchar" }] },
                { name: "users", columns: [{ name: "id", type: "bigint" }, { name: "email", type: "varchar" }, { name: "created_at", type: "timestamp" }] },
                { name: "orders", columns: [{ name: "id", type: "bigint" }, { name: "user_id", type: "bigint" }, { name: "amount", type: "decimal" }, { name: "created_at", type: "timestamp" }] },
                { name: "products", columns: [{ name: "id", type: "bigint" }, { name: "name", type: "varchar" }, { name: "category", type: "varchar" }, { name: "price", type: "decimal" }] },
              ],
            },
          ],
        }, null, 2),
      }],
    };
  }
);

// ============================================
// RESOURCES
// ============================================

// Query results resource
server.resource(
  "query://{queryId}/results",
  "Query execution results",
  async (uri) => {
    const query = queries.get(uri.params.queryId);
    if (!query) {
      throw new Error(`Query not found: ${uri.params.queryId}`);
    }
    const result = await executeQuery(query, {});
    return {
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(result, null, 2),
      }],
    };
  }
);

// Visualization spec resource
server.resource(
  "visualization://{visualizationId}/spec",
  "Vega-Lite specification for visualization",
  async (uri) => {
    const viz = visualizations.get(uri.params.visualizationId);
    if (!viz) {
      throw new Error(`Visualization not found: ${uri.params.visualizationId}`);
    }
    if (!viz.spec) {
      const query = queries.get(viz.queryId);
      if (query) {
        viz.spec = generateVegaLiteSpec(viz, query);
        visualizations.set(uri.params.visualizationId, viz);
      }
    }
    return {
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(viz.spec, null, 2),
      }],
    };
  }
);

// Dashboard resource
server.resource(
  "dashboard://{dashboardId}",
  "Dashboard configuration and data",
  async (uri) => {
    const dashboard = dashboards.get(uri.params.dashboardId);
    if (!dashboard) {
      throw new Error(`Dashboard not found: ${uri.params.dashboardId}`);
    }

    // Include visualization specs
    const vizData = await Promise.all(
      dashboard.visualizations.map(async (vid) => {
        const viz = visualizations.get(vid);
        if (!viz) return null;
        const query = queries.get(viz.queryId);
        if (!query) return null;
        const result = await executeQuery(query, {});
        return { visualization: viz, queryResult: result };
      })
    );

    return {
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify({ dashboard, visualizations: vizData.filter(Boolean) }, null, 2),
      }],
    };
  }
);

// Schema resource
server.resource(
  "schema://{dataSourceId}",
  "Database schema information",
  async (uri) => {
    const ds = dataSources.get(uri.params.dataSourceId);
    if (!ds) {
      throw new Error(`Data source not found: ${uri.params.dataSourceId}`);
    }

    return {
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify({
          dataSource: ds.name,
          type: ds.type,
          schemas: [
            { name: "public", tables: ["events", "users", "orders", "products"] },
            { name: "analytics", tables: ["dau_summary", "revenue_daily", "funnel_metrics"] },
          ],
        }, null, 2),
      }],
    };
  }
);

// ============================================
// PROMPTS
// ============================================

// Data analysis prompt
server.prompt(
  "analyze-data",
  "Analyze query results and provide insights",
  {
    queryId: z.string().describe("Query ID to analyze"),
    context: z.string().optional().describe("Business context for analysis"),
  },
  ({ queryId, context }) => {
    const query = queries.get(queryId);
    if (!query) {
      return {
        messages: [
          { role: "system", content: "You are a data analyst." },
          { role: "user", content: `Query ${queryId} not found.` },
        ],
      };
    }

    return {
      messages: [
        {
          role: "system",
          content: "You are an expert data analyst. Analyze the query results and provide actionable insights, trends, and recommendations.",
        },
        {
          role: "user",
          content: `Analyze the results of query: ${query.name}\nSQL: ${query.sql}\nContext: ${context || "General business analysis"}\n\nProvide insights on trends, anomalies, and actionable recommendations.`,
        },
      ],
    };
  }
);

// Dashboard narrative prompt
server.prompt(
  "dashboard-narrative",
  "Generate a narrative summary for a dashboard",
  {
    dashboardId: z.string().describe("Dashboard ID"),
    audience: z.enum(["executive", "technical", "general"]).optional().default("executive").describe("Target audience"),
  },
  ({ dashboardId, audience = "executive" }) => {
    const dashboard = dashboards.get(dashboardId);
    if (!dashboard) {
      return {
        messages: [
          { role: "system", content: "You are a business intelligence analyst." },
          { role: "user", content: `Dashboard ${dashboardId} not found.` },
        ],
      };
    }

    const tone = audience === "executive" ? "concise and strategic" : audience === "technical" ? "detailed and technical" : "clear and accessible";

    return {
      messages: [
        {
          role: "system",
          content: `You are a BI analyst creating a ${tone} narrative summary of a dashboard for ${audience} audience.`,
        },
        {
          role: "user",
          content: `Dashboard: ${dashboard.name}\nDescription: ${dashboard.description || "No description"}\nVisualizations: ${dashboard.visualizations.length}\n\nWrite a narrative summary highlighting key metrics, trends, and action items.`,
        },
      ],
    };
  }
);

// SQL optimization prompt
server.prompt(
  "optimize-sql",
  "Get SQL optimization suggestions",
  {
    sql: z.string().describe("SQL query to optimize"),
    dataSourceType: z.enum(["postgresql", "clickhouse", "bigquery", "snowflake"]).describe("Target database"),
  },
  ({ sql, dataSourceType }) => {
    return {
      messages: [
        {
          role: "system",
          content: `You are a SQL performance expert specializing in ${dataSourceType}. Analyze the query and provide specific optimization recommendations.`,
        },
        {
          role: "user",
          content: `Optimize this ${dataSourceType} query:\n\`\`\`sql\n${sql}\n\`\`\`\n\nProvide: 1) Performance issues identified, 2) Specific optimizations, 3) Rewritten query, 4) Index recommendations.`,
        },
      ],
    };
  }
);

// ============================================
// HEALTH CHECK
// ============================================

server.tool(
  "health",
  "Health check endpoint",
  {},
  async () => {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          status: "healthy",
          timestamp: new Date().toISOString(),
          dataSources: dataSources.size,
          connectedSources: Array.from(dataSources.values()).filter(ds => ds.status === "connected").length,
          queries: queries.size,
          visualizations: visualizations.size,
          dashboards: dashboards.size,
          reports: reports.size,
        }, null, 2),
      }],
    };
  }
);

// Helper functions
function generateVegaLiteSpec(viz: Visualization, query: Query): object {
  const baseSpec = {
    $schema: "https://vega.github.io/schema/vega-lite/v5.json",
    title: viz.config.title || viz.name,
    width: "container",
    height: 300,
  };

  switch (viz.type) {
    case "line":
      return {
        ...baseSpec,
        mark: "line",
        encoding: {
          x: { field: viz.config.x, type: "temporal", title: viz.config.x },
          y: { field: viz.config.y, type: "quantitative", title: viz.config.y },
        },
      };
    case "bar":
      return {
        ...baseSpec,
        mark: "bar",
        encoding: {
          x: { field: viz.config.x, type: "nominal", title: viz.config.x },
          y: { field: viz.config.y, type: "quantitative", title: viz.config.y },
        },
      };
    case "pie":
      return {
        ...baseSpec,
        mark: "arc",
        encoding: {
          theta: { field: viz.config.y, type: "quantitative" },
          color: { field: viz.config.x, type: "nominal" },
        },
      };
    case "table":
      return {
        ...baseSpec,
        mark: "text",
        encoding: {
          text: { field: "value", type: "nominal" },
        },
      };
    default:
      return baseSpec;
  }
}

function calculateNextRun(cron: string): string {
  // Simplified - in real implementation use a cron parser
  const next = new Date();
  next.setHours(next.getHours() + 1);
  return next.toISOString();
}

// Start server
async function main() {
  const transport = process.env.MCP_TRANSPORT || "websocket";
  const port = parseInt(process.env.MCP_PORT || "3000", 10);
  const host = process.env.MCP_HOST || "0.0.0.0";

  console.error(`Starting analytics-engine on ${transport}...`);

  if (transport === "websocket") {
    await server.start({ transport: "websocket", port, host });
  } else if (transport === "http-sse") {
    await server.start({ transport: "http-sse", port, host });
  } else if (transport === "grpc") {
    await server.start({ transport: "grpc", port, host });
  } else {
    await server.start({ transport: "stdio" });
  }

  console.error("Analytics engine server started successfully");
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
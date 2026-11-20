#!/usr/bin/env python3
"""
Analytics Engine MCP Server
SQL query builder, visualization resources, report generation, and alerting
"""

import asyncio
import json
import os
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal
from enum import Enum
from typing import Any, Dict, List, Optional

from mcp.server import McpServer, tool, resource, prompt
from pydantic import BaseModel, Field


# ============================================
# MODELS
# ============================================

class QueryStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class VisualizationType(str, Enum):
    TABLE = "table"
    LINE = "line"
    BAR = "bar"
    PIE = "pie"
    SCATTER = "scatter"
    HEATMAP = "heatmap"
    GEO = "geo"
    FUNNEL = "funnel"
    GAUGE = "gauge"


@dataclass
class DataSource:
    id: str
    name: str
    type: str  # postgres, mysql, clickhouse, bigquery, snowflake, csv
    connection_string: str
    schema: Optional[str] = None
    description: str = ""
    is_active: bool = True
    metadata: Dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())


@dataclass
class SavedQuery:
    id: str
    name: str
    description: str
    sql: str
    data_source_id: str
    parameters: List[Dict[str, Any]] = field(default_factory=list)
    tags: List[str] = field(default_factory=list)
    created_by: str = ""
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())


@dataclass
class QueryExecution:
    id: str
    query_id: Optional[str]
    sql: str
    data_source_id: str
    status: QueryStatus = QueryStatus.PENDING
    parameters: Dict[str, Any] = field(default_factory=dict)
    result_columns: List[str] = field(default_factory=list)
    result_rows: List[List[Any]] = field(default_factory=list)
    row_count: int = 0
    execution_time_ms: int = 0
    error: str = ""
    started_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    completed_at: Optional[str] = None


@dataclass
class Visualization:
    id: str
    name: str
    description: str
    query_id: str
    type: VisualizationType
    config: Dict[str, Any] = field(default_factory=dict)
    created_by: str = ""
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())


@dataclass
class Dashboard:
    id: str
    name: str
    description: str
    visualizations: List[str] = field(default_factory=list)  # visualization IDs
    layout: Dict[str, Any] = field(default_factory=dict)
    refresh_interval_sec: int = 300
    is_public: bool = False
    created_by: str = ""
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())


@dataclass
class Report:
    id: str
    name: str
    description: str
    query_ids: List[str] = field(default_factory=list)
    visualization_ids: List[str] = field(default_factory=list)
    schedule: Optional[str] = None  # cron expression
    recipients: List[str] = field(default_factory=list)
    format: str = "pdf"  # pdf, html, csv, json
    is_active: bool = True
    last_run: Optional[str] = None
    next_run: Optional[str] = None
    created_by: str = ""
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())


@dataclass
class Alert:
    id: str
    name: str
    description: str
    query_id: str
    condition: str  # e.g., "value > 1000", "count == 0"
    threshold: float
    comparison: str  # gt, gte, lt, lte, eq, ne
    severity: str = "warning"  # info, warning, critical
    recipients: List[str] = field(default_factory=list)
    cooldown_minutes: int = 60
    is_active: bool = True
    last_triggered: Optional[str] = None
    created_by: str = ""
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())


# ============================================
# IN-MEMORY STORES
# ============================================

data_sources: Dict[str, DataSource] = {}
saved_queries: Dict[str, SavedQuery] = {}
query_executions: Dict[str, QueryExecution] = {}
visualizations: Dict[str, Visualization] = {}
dashboards: Dict[str, Dashboard] = {}
reports: Dict[str, Report] = {}
alerts: Dict[str, Alert] = {}


def initialize_sample_data():
    """Initialize sample analytics data."""
    # Sample data sources
    ds1 = DataSource(
        id="ds-001",
        name="Production PostgreSQL",
        type="postgres",
        connection_string="postgresql://user:pass@localhost:5432/prod",
        schema="public",
        description="Main production database",
    )
    ds2 = DataSource(
        id="ds-002",
        name="Analytics ClickHouse",
        type="clickhouse",
        connection_string="clickhouse://user:pass@localhost:8123/analytics",
        description="Analytics warehouse",
    )
    data_sources[ds1.id] = ds1
    data_sources[ds2.id] = ds2

    # Sample queries
    q1 = SavedQuery(
        id="q-001",
        name="Daily Active Users",
        description="Count of unique users per day",
        sql="SELECT DATE(event_time) as date, COUNT(DISTINCT user_id) as dau FROM events WHERE event_time >= NOW() - INTERVAL '30 days' GROUP BY 1 ORDER BY 1",
        data_source_id="ds-001",
        tags=["metrics", "daily", "users"],
    )
    q2 = SavedQuery(
        id="q-002",
        name="Revenue by Channel",
        description="Revenue breakdown by acquisition channel",
        sql="SELECT channel, SUM(amount) as revenue, COUNT(*) as orders FROM orders WHERE created_at >= NOW() - INTERVAL '7 days' GROUP BY 1 ORDER BY 2 DESC",
        data_source_id="ds-001",
        tags=["revenue", "channel", "weekly"],
    )
    saved_queries[q1.id] = q1
    saved_queries[q2.id] = q2

    # Sample visualizations
    v1 = Visualization(
        id="viz-001",
        name="DAU Trend",
        description="Daily active users over 30 days",
        query_id="q-001",
        type=VisualizationType.LINE,
        config={"x_axis": "date", "y_axis": "dau", "title": "Daily Active Users"},
    )
    v2 = Visualization(
        id="viz-002",
        name="Revenue by Channel",
        description="Revenue breakdown by channel",
        query_id="q-002",
        type=VisualizationType.PIE,
        config={"label": "channel", "value": "revenue", "title": "Revenue by Channel"},
    )
    visualizations[v1.id] = v1
    visualizations[v2.id] = v2

    # Sample dashboard
    d1 = Dashboard(
        id="dash-001",
        name="Executive Overview",
        description="Key business metrics at a glance",
        visualizations=["viz-001", "viz-002"],
        layout={"viz-001": {"x": 0, "y": 0, "w": 12, "h": 6}, "viz-002": {"x": 12, "y": 0, "w": 12, "h": 6}},
    )
    dashboards[d1.id] = d1


initialize_sample_data()


# ============================================
# MOCK QUERY EXECUTION
# ============================================

async def execute_query_mock(sql: str, data_source_id: str, parameters: Dict[str, Any]) -> QueryExecution:
    """Mock query execution returning sample data."""
    execution_id = f"exec-{uuid.uuid4().hex[:12]}"
    execution = QueryExecution(
        id=execution_id,
        query_id=None,
        sql=sql,
        data_source_id=data_source_id,
        status=QueryStatus.RUNNING,
        parameters=parameters,
    )
    query_executions[execution_id] = execution

    # Simulate execution
    await asyncio.sleep(0.5)

    # Mock results based on query
    if "dau" in sql.lower() or "daily active" in sql.lower():
        execution.result_columns = ["date", "dau"]
        execution.result_rows = [
            [(datetime.utcnow() - timedelta(days=i)).strftime("%Y-%m-%d"), 1000 + i * 50]
            for i in range(30, 0, -1)
        ]
    elif "revenue" in sql.lower() and "channel" in sql.lower():
        execution.result_columns = ["channel", "revenue", "orders"]
        execution.result_rows = [
            ["organic", 45000.00, 1200],
            ["paid_search", 32000.00, 850],
            ["social", 18000.00, 600],
            ["email", 12000.00, 400],
            ["direct", 8000.00, 300],
        ]
    else:
        execution.result_columns = ["column1", "column2", "column3"]
        execution.result_rows = [["sample", "data", 123]]

    execution.row_count = len(execution.result_rows)
    execution.execution_time_ms = 450
    execution.status = QueryStatus.COMPLETED
    execution.completed_at = datetime.utcnow().isoformat()

    return execution


# ============================================
# MCP SERVER
# ============================================

server = McpServer(
    name="analytics-engine",
    version="1.0.0",
    capabilities={
        "tools": {"listChanged": True},
        "resources": {"subscribe": True, "listChanged": True},
        "prompts": {"listChanged": True},
        "logging": {},
    },
)


# ============================================
# TOOLS - DATA SOURCES
# ============================================

@server.tool("register-data-source", "Register a data source")
async def register_data_source(
    name: str,
    type: str,
    connection_string: str,
    schema: Optional[str] = None,
    description: str = "",
) -> Dict[str, Any]:
    """Register a new data source."""
    ds_id = f"ds-{uuid.uuid4().hex[:8]}"
    ds = DataSource(
        id=ds_id,
        name=name,
        type=type,
        connection_string=connection_string,
        schema=schema,
        description=description,
    )
    data_sources[ds_id] = ds
    return ds.__dict__


@server.tool("list-data-sources", "List data sources")
async def list_data_sources(active_only: bool = True) -> Dict[str, Any]:
    """List all data sources."""
    result = list(data_sources.values())
    if active_only:
        result = [ds for ds in result if ds.is_active]
    return {"data_sources": [ds.__dict__ for ds in result], "count": len(result)}


@server.tool("get-data-source", "Get data source details")
async def get_data_source(data_source_id: str) -> Dict[str, Any]:
    """Get data source details."""
    ds = data_sources.get(data_source_id)
    if not ds:
        return {"error": "Data source not found", "data_source_id": data_source_id}
    # Don't return connection string in detail
    result = ds.__dict__.copy()
    result["connection_string"] = "***REDACTED***"
    return result


@server.tool("test-data-source", "Test data source connection")
async def test_data_source(data_source_id: str) -> Dict[str, Any]:
    """Test data source connectivity."""
    ds = data_sources.get(data_source_id)
    if not ds:
        return {"error": "Data source not found", "data_source_id": data_source_id}

    # Mock test
    await asyncio.sleep(0.2)
    return {"success": True, "message": f"Connected to {ds.type} successfully", "latency_ms": 45}


# ============================================
# TOOLS - QUERIES
# ============================================

@server.tool("save-query", "Save a SQL query")
async def save_query(
    name: str,
    sql: str,
    data_source_id: str,
    description: str = "",
    parameters: Optional[List[Dict[str, Any]]] = None,
    tags: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Save a SQL query for reuse."""
    query_id = f"q-{uuid.uuid4().hex[:8]}"
    query = SavedQuery(
        id=query_id,
        name=name,
        description=description,
        sql=sql,
        data_source_id=data_source_id,
        parameters=parameters or [],
        tags=tags or [],
    )
    saved_queries[query_id] = query
    return query.__dict__


@server.tool("list-queries", "List saved queries")
async def list_queries(
    data_source_id: Optional[str] = None,
    tags: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """List saved queries with filters."""
    result = list(saved_queries.values())
    if data_source_id:
        result = [q for q in result if q.data_source_id == data_source_id]
    if tags:
        result = [q for q in result if any(t in q.tags for t in tags)]
    return {"queries": [q.__dict__ for q in result], "count": len(result)}


@server.tool("get-query", "Get saved query")
async def get_query(query_id: str) -> Dict[str, Any]:
    """Get saved query details."""
    query = saved_queries.get(query_id)
    if not query:
        return {"error": "Query not found", "query_id": query_id}
    return query.__dict__


@server.tool("execute-query", "Execute a SQL query")
async def execute_query(
    sql: str,
    data_source_id: str,
    parameters: Optional[Dict[str, Any]] = None,
    query_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Execute a SQL query."""
    execution = await execute_query_mock(sql, data_source_id, parameters or {})
    if query_id:
        execution.query_id = query_id
    query_executions[execution.id] = execution
    return execution.__dict__


@server.tool("execute-saved-query", "Execute a saved query by ID")
async def execute_saved_query(
    query_id: str,
    parameters: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Execute a saved query."""
    query = saved_queries.get(query_id)
    if not query:
        return {"error": "Query not found", "query_id": query_id}

    execution = await execute_query_mock(query.sql, query.data_source_id, parameters or {})
    execution.query_id = query_id
    query_executions[execution.id] = execution
    return execution.__dict__


@server.tool("get-execution", "Get query execution result")
async def get_execution(execution_id: str) -> Dict[str, Any]:
    """Get query execution result."""
    execution = query_executions.get(execution_id)
    if not execution:
        return {"error": "Execution not found", "execution_id": execution_id}
    return execution.__dict__


@server.tool("list-executions", "List query executions")
async def list_executions(
    query_id: Optional[str] = None,
    data_source_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50,
) -> Dict[str, Any]:
    """List query executions with filters."""
    result = list(query_executions.values())
    if query_id:
        result = [e for e in result if e.query_id == query_id]
    if data_source_id:
        result = [e for e in result if e.data_source_id == data_source_id]
    if status:
        result = [e for e in result if e.status.value == status]

    result.sort(key=lambda e: e.started_at, reverse=True)
    return {"executions": [e.__dict__ for e in result[:limit]], "total": len(result)}


@server.tool("cancel-execution", "Cancel running query")
async def cancel_execution(execution_id: str) -> Dict[str, Any]:
    """Cancel a running query execution."""
    execution = query_executions.get(execution_id)
    if not execution:
        return {"error": "Execution not found", "execution_id": execution_id}

    if execution.status not in [QueryStatus.PENDING, QueryStatus.RUNNING]:
        return {"error": f"Cannot cancel execution in {execution.status.value} status"}

    execution.status = QueryStatus.CANCELLED
    execution.completed_at = datetime.utcnow().isoformat()
    return {"success": True, "execution": execution.__dict__}


# ============================================
# TOOLS - VISUALIZATIONS
# ============================================

@server.tool("create-visualization", "Create a visualization")
async def create_visualization(
    name: str,
    query_id: str,
    type: str,
    config: Dict[str, Any],
    description: str = "",
) -> Dict[str, Any]:
    """Create a visualization from query results."""
    query = saved_queries.get(query_id)
    if not query:
        return {"error": "Query not found", "query_id": query_id}

    viz_id = f"viz-{uuid.uuid4().hex[:8]}"
    viz = Visualization(
        id=viz_id,
        name=name,
        description=description,
        query_id=query_id,
        type=VisualizationType(type),
        config=config,
    )
    visualizations[viz_id] = viz
    return viz.__dict__


@server.tool("list-visualizations", "List visualizations")
async def list_visualizations(query_id: Optional[str] = None) -> Dict[str, Any]:
    """List visualizations."""
    result = list(visualizations.values())
    if query_id:
        result = [v for v in result if v.query_id == query_id]
    return {"visualizations": [v.__dict__ for v in result], "count": len(result)}


@server.tool("get-visualization", "Get visualization")
async def get_visualization(visualization_id: str) -> Dict[str, Any]:
    """Get visualization with rendered data."""
    viz = visualizations.get(visualization_id)
    if not viz:
        return {"error": "Visualization not found", "visualization_id": visualization_id}

    # Get query execution for data
    query = saved_queries.get(viz.query_id)
    if not query:
        return {"error": "Associated query not found"}

    # Use latest execution or execute
    executions = [e for e in query_executions.values() if e.query_id == viz.query_id and e.status == QueryStatus.COMPLETED]
    if executions:
        executions.sort(key=lambda e: e.completed_at or "", reverse=True)
        execution = executions[0]
    else:
        execution = await execute_query_mock(query.sql, query.data_source_id, {})
        execution.query_id = viz.query_id
        query_executions[execution.id] = execution

    return {
        "visualization": viz.__dict__,
        "data": {
            "columns": execution.result_columns,
            "rows": execution.result_rows,
        },
    }


@server.tool("update-visualization", "Update visualization")
async def update_visualization(
    visualization_id: str,
    name: Optional[str] = None,
    description: Optional[str] = None,
    config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Update visualization properties."""
    viz = visualizations.get(visualization_id)
    if not viz:
        return {"error": "Visualization not found", "visualization_id": visualization_id}

    if name:
        viz.name = name
    if description:
        viz.description = description
    if config:
        viz.config.update(config)
    viz.updated_at = datetime.utcnow().isoformat()

    return viz.__dict__


# ============================================
# TOOLS - DASHBOARDS
# ============================================

@server.tool("create-dashboard", "Create a dashboard")
async def create_dashboard(
    name: str,
    description: str,
    visualization_ids: List[str],
    layout: Optional[Dict[str, Any]] = None,
    refresh_interval_sec: int = 300,
    is_public: bool = False,
) -> Dict[str, Any]:
    """Create a dashboard."""
    dash_id = f"dash-{uuid.uuid4().hex[:8]}"
    dashboard = Dashboard(
        id=dash_id,
        name=name,
        description=description,
        visualizations=visualization_ids,
        layout=layout or {},
        refresh_interval_sec=refresh_interval_sec,
        is_public=is_public,
    )
    dashboards[dash_id] = dashboard
    return dashboard.__dict__


@server.tool("list-dashboards", "List dashboards")
async def list_dashboards(public_only: bool = False) -> Dict[str, Any]:
    """List dashboards."""
    result = list(dashboards.values())
    if public_only:
        result = [d for d in result if d.is_public]
    return {"dashboards": [d.__dict__ for d in result], "count": len(result)}


@server.tool("get-dashboard", "Get dashboard with visualizations")
async def get_dashboard(dashboard_id: str) -> Dict[str, Any]:
    """Get dashboard with all visualization data."""
    dashboard = dashboards.get(dashboard_id)
    if not dashboard:
        return {"error": "Dashboard not found", "dashboard_id": dashboard_id}

    viz_data = []
    for viz_id in dashboard.visualizations:
        viz = visualizations.get(viz_id)
        if viz:
            query = saved_queries.get(viz.query_id)
            if query:
                executions = [e for e in query_executions.values() if e.query_id == viz.query_id and e.status == QueryStatus.COMPLETED]
                if executions:
                    executions.sort(key=lambda e: e.completed_at or "", reverse=True)
                    execution = executions[0]
                    viz_data.append({
                        "visualization": viz.__dict__,
                        "data": {"columns": execution.result_columns, "rows": execution.result_rows},
                    })

    return {"dashboard": dashboard.__dict__, "visualizations": viz_data}


# ============================================
# TOOLS - REPORTS
# ============================================

@server.tool("create-report", "Create a scheduled report")
async def create_report(
    name: str,
    description: str,
    query_ids: List[str],
    visualization_ids: List[str],
    schedule: Optional[str] = None,
    recipients: Optional[List[str]] = None,
    format: str = "pdf",
) -> Dict[str, Any]:
    """Create a scheduled report."""
    report_id = f"rpt-{uuid.uuid4().hex[:8]}"
    report = Report(
        id=report_id,
        name=name,
        description=description,
        query_ids=query_ids,
        visualization_ids=visualization_ids,
        schedule=schedule,
        recipients=recipients or [],
        format=format,
    )
    reports[report_id] = report
    return report.__dict__


@server.tool("generate-report", "Generate report on demand")
async def generate_report(report_id: str) -> Dict[str, Any]:
    """Generate a report immediately."""
    report = reports.get(report_id)
    if not report:
        return {"error": "Report not found", "report_id": report_id}

    # Collect data from queries and visualizations
    query_data = {}
    for qid in report.query_ids:
        query = saved_queries.get(qid)
        if query:
            executions = [e for e in query_executions.values() if e.query_id == qid and e.status == QueryStatus.COMPLETED]
            if executions:
                executions.sort(key=lambda e: e.completed_at or "", reverse=True)
                execution = executions[0]
                query_data[qid] = {"columns": execution.result_columns, "rows": execution.result_rows}

    viz_data = {}
    for vid in report.visualization_ids:
        viz = visualizations.get(vid)
        if viz:
            query = saved_queries.get(viz.query_id)
            if query:
                executions = [e for e in query_executions.values() if e.query_id == viz.query_id and e.status == QueryStatus.COMPLETED]
                if executions:
                    executions.sort(key=lambda e: e.completed_at or "", reverse=True)
                    execution = executions[0]
                    viz_data[vid] = {"visualization": viz.__dict__, "data": {"columns": execution.result_columns, "rows": execution.result_rows}}

    report.last_run = datetime.utcnow().isoformat()

    return {
        "report_id": report_id,
        "generated_at": report.last_run,
        "format": report.format,
        "query_data": query_data,
        "visualization_data": viz_data,
    }


# ============================================
# TOOLS - ALERTS
# ============================================

@server.tool("create-alert", "Create a data alert")
async def create_alert(
    name: str,
    description: str,
    query_id: str,
    condition: str,
    threshold: float,
    comparison: str,
    severity: str = "warning",
    recipients: Optional[List[str]] = None,
    cooldown_minutes: int = 60,
) -> Dict[str, Any]:
    """Create a data alert."""
    query = saved_queries.get(query_id)
    if not query:
        return {"error": "Query not found", "query_id": query_id}

    alert_id = f"alert-{uuid.uuid4().hex[:8]}"
    alert = Alert(
        id=alert_id,
        name=name,
        description=description,
        query_id=query_id,
        condition=condition,
        threshold=threshold,
        comparison=comparison,
        severity=severity,
        recipients=recipients or [],
        cooldown_minutes=cooldown_minutes,
    )
    alerts[alert_id] = alert
    return alert.__dict__


@server.tool("check-alerts", "Check all alerts")
async def check_alerts() -> Dict[str, Any]:
    """Evaluate all active alerts."""
    triggered = []

    for alert in alerts.values():
        if not alert.is_active:
            continue

        # Get latest execution
        executions = [e for e in query_executions.values() if e.query_id == alert.query_id and e.status == QueryStatus.COMPLETED]
        if not executions:
            continue

        executions.sort(key=lambda e: e.completed_at or "", reverse=True)
        execution = executions[0]

        if execution.result_rows:
            # Simple condition check on first numeric column
            try:
                value = float(execution.result_rows[0][1]) if len(execution.result_rows[0]) > 1 else float(execution.result_rows[0][0])
                triggered_alert = False

                if alert.comparison == "gt" and value > alert.threshold:
                    triggered_alert = True
                elif alert.comparison == "gte" and value >= alert.threshold:
                    triggered_alert = True
                elif alert.comparison == "lt" and value < alert.threshold:
                    triggered_alert = True
                elif alert.comparison == "lte" and value <= alert.threshold:
                    triggered_alert = True
                elif alert.comparison == "eq" and value == alert.threshold:
                    triggered_alert = True
                elif alert.comparison == "ne" and value != alert.threshold:
                    triggered_alert = True

                if triggered_alert:
                    alert.last_triggered = datetime.utcnow().isoformat()
                    triggered.append({
                        "alert": alert.__dict__,
                        "value": value,
                        "threshold": alert.threshold,
                    })
            except (ValueError, IndexError):
                pass

    return {"triggered": triggered, "checked": len(alerts)}


# ============================================
# RESOURCES
# ============================================

@server.resource("datasource://{data_source_id}", "Data source")
async def datasource_resource(data_source_id: str) -> Dict[str, Any]:
    """Data source resource."""
    ds = data_sources.get(data_source_id)
    if not ds:
        raise ValueError(f"Data source not found: {data_source_id}")
    result = ds.__dict__.copy()
    result["connection_string"] = "***REDACTED***"
    return result


@server.resource("query://{query_id}", "Saved query")
async def query_resource(query_id: str) -> Dict[str, Any]:
    """Saved query resource."""
    query = saved_queries.get(query_id)
    if not query:
        raise ValueError(f"Query not found: {query_id}")
    return query.__dict__


@server.resource("execution://{execution_id}", "Query execution")
async def execution_resource(execution_id: str) -> Dict[str, Any]:
    """Query execution resource."""
    execution = query_executions.get(execution_id)
    if not execution:
        raise ValueError(f"Execution not found: {execution_id}")
    return execution.__dict__


@server.resource("visualization://{visualization_id}", "Visualization")
async def visualization_resource(visualization_id: str) -> Dict[str, Any]:
    """Visualization resource."""
    viz = visualizations.get(visualization_id)
    if not viz:
        raise ValueError(f"Visualization not found: {visualization_id}")
    return viz.__dict__


@server.resource("dashboard://{dashboard_id}", "Dashboard")
async def dashboard_resource(dashboard_id: str) -> Dict[str, Any]:
    """Dashboard resource."""
    dashboard = dashboards.get(dashboard_id)
    if not dashboard:
        raise ValueError(f"Dashboard not found: {dashboard_id}")
    return dashboard.__dict__


@server.resource("report://{report_id}", "Report")
async def report_resource(report_id: str) -> Dict[str, Any]:
    """Report resource."""
    report = reports.get(report_id)
    if not report:
        raise ValueError(f"Report not found: {report_id}")
    return report.__dict__


@server.resource("alert://{alert_id}", "Alert")
async def alert_resource(alert_id: str) -> Dict[str, Any]:
    """Alert resource."""
    alert = alerts.get(alert_id)
    if not alert:
        raise ValueError(f"Alert not found: {alert_id}")
    return alert.__dict__


# ============================================
# PROMPTS
# ============================================

@server.prompt("analyze-metrics", "Analyze business metrics")
async def analyze_metrics_prompt(
    metric_name: str,
    time_range: str = "7 days",
    context: str = "",
) -> Dict[str, Any]:
    """Analyze business metrics prompt."""
    prompt = f"""You are a data analyst. Analyze the {metric_name} metric over the last {time_range}.

Context: {context or 'General business analysis'}

Provide:
1. Trend analysis (increasing, decreasing, stable)
2. Key drivers or anomalies
3. Comparison to previous period
4. Actionable recommendations
5. Questions for further investigation"""

    return {
        "messages": [
            {"role": "system", "content": "You are an expert data analyst. Provide clear, actionable insights with supporting reasoning."},
            {"role": "user", "content": prompt},
        ]
    }


@server.prompt("build-dashboard", "Build a dashboard")
async def build_dashboard_prompt(
    business_question: str,
    available_metrics: List[str],
    audience: str = "executives",
) -> Dict[str, Any]:
    """Build dashboard prompt."""
    prompt = f"""Design a dashboard to answer: {business_question}

Available metrics: {', '.join(available_metrics)}
Target audience: {audience}

Provide:
1. Dashboard layout with visualization types
2. Key metrics and their positions
3. Recommended filters and date ranges
4. Refresh frequency
5. Alert thresholds"""

    return {
        "messages": [
            {"role": "system", "content": "You are a BI dashboard designer. Create effective, actionable dashboards."},
            {"role": "user", "content": prompt},
        ]
    }


@server.prompt("sql-optimization", "Optimize SQL query")
async def sql_optimization_prompt(
    sql: str,
    data_source_type: str,
    explain_plan: Optional[str] = None,
) -> Dict[str, Any]:
    """SQL optimization prompt."""
    prompt = f"""Optimize this SQL query for {data_source_type}:

```sql
{sql}
```

{f"Explain plan:\n{explain_plan}" if explain_plan else ""}

Provide:
1. Optimized query
2. Index recommendations
3. Performance considerations
4. Alternative approaches"""

    return {
        "messages": [
            {"role": "system", "content": "You are a database performance expert. Provide specific, actionable optimizations."},
            {"role": "user", "content": prompt},
        ]
    }


# ============================================
# HEALTH CHECK
# ============================================

@server.tool("health", "Health check")
async def health() -> Dict[str, Any]:
    """Health check endpoint."""
    running_executions = sum(1 for e in query_executions.values() if e.status == QueryStatus.RUNNING)
    active_alerts = sum(1 for a in alerts.values() if a.is_active)

    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "data_sources": len(data_sources),
        "saved_queries": len(saved_queries),
        "executions": {"total": len(query_executions), "running": running_executions},
        "visualizations": len(visualizations),
        "dashboards": len(dashboards),
        "reports": len(reports),
        "alerts": {"total": len(alerts), "active": active_alerts},
    }


# ============================================
# MAIN
# ============================================

async def main():
    transport = os.getenv("MCP_TRANSPORT", "websocket")
    port = int(os.getenv("MCP_PORT", "3000"))
    host = os.getenv("MCP_HOST", "0.0.0.0")

    print(f"Starting analytics-engine on {transport}...", file=sys.stderr)

    if transport == "websocket":
        await server.start(transport="websocket", port=port, host=host)
    elif transport == "http-sse":
        await server.start(transport="http-sse", port=port, host=host)
    elif transport == "grpc":
        await server.start(transport="grpc", port=port, host=host)
    else:
        await server.start(transport="stdio")

    print("Analytics engine server started", file=sys.stderr)


if __name__ == "__main__":
    import sys
    asyncio.run(main())
#!/usr/bin/env python3
"""
Data Pipeline MCP Server
ETL pipelines, data sources, transformations, and pipeline orchestration
"""

import asyncio
import json
import os
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from mcp.server import McpServer, tool, resource, prompt
from pydantic import BaseModel, Field


# ============================================
# MODELS
# ============================================

class SourceType(str, Enum):
    DATABASE = "database"
    API = "api"
    FILE = "file"
    STREAM = "stream"
    WAREHOUSE = "warehouse"


class PipelineStatus(str, Enum):
    DRAFT = "draft"
    ACTIVE = "active"
    PAUSED = "paused"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class RunStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class DataSource:
    id: str
    name: str
    type: SourceType
    config: Dict[str, Any]  # connection details, credentials ref
    schema: Optional[Dict[str, Any]] = None
    description: str = ""
    is_active: bool = True
    tags: List[str] = field(default_factory=list)
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())


@dataclass
class Transformation:
    id: str
    name: str
    description: str
    sql: str = ""  # SQL transformation
    python: str = ""  # Python transformation
    input_schema: Dict[str, Any] = field(default_factory=dict)
    output_schema: Dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())


@dataclass
class Pipeline:
    id: str
    name: str
    description: str
    source_ids: List[str]
    transformation_ids: List[str]
    destination_id: str
    schedule: Optional[str] = None  # cron expression
    status: PipelineStatus = PipelineStatus.DRAFT
    config: Dict[str, Any] = field(default_factory=dict)
    tags: List[str] = field(default_factory=list)
    created_by: str = ""
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())


@dataclass
class PipelineRun:
    id: str
    pipeline_id: str
    status: RunStatus = RunStatus.PENDING
    triggered_by: str = "manual"  # manual, schedule, api
    parameters: Dict[str, Any] = field(default_factory=dict)
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    rows_processed: int = 0
    bytes_processed: int = 0
    error: str = ""
    logs: List[str] = field(default_factory=list)
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())


@dataclass
class DataQualityCheck:
    id: str
    name: str
    description: str
    pipeline_id: str
    check_type: str  # row_count, null_check, duplicate_check, schema_check, custom_sql
    config: Dict[str, Any] = field(default_factory=dict)
    threshold: float = 0.0
    severity: str = "warning"  # info, warning, critical
    is_active: bool = True


# ============================================
# IN-MEMORY STORES
# ============================================

data_sources: Dict[str, DataSource] = {}
transformations: Dict[str, Transformation] = {}
pipelines: Dict[str, Pipeline] = {}
pipeline_runs: Dict[str, PipelineRun] = {}
quality_checks: Dict[str, DataQualityCheck] = {}


def initialize_sample_data():
    """Initialize sample data pipeline data."""
    # Sample data sources
    ds1 = DataSource(
        id="src-001",
        name="Production PostgreSQL",
        type=SourceType.DATABASE,
        config={"host": "prod-db", "port": 5432, "database": "app", "schema": "public"},
        description="Main application database",
        tags=["production", "postgres"],
    )
    ds2 = DataSource(
        id="src-002",
        name="Events Kafka",
        type=SourceType.STREAM,
        config={"bootstrap_servers": "kafka:9092", "topic": "events", "group_id": "etl"},
        description="Real-time event stream",
        tags=["streaming", "kafka"],
    )
    ds3 = DataSource(
        id="src-003",
        name="Analytics Warehouse",
        type=SourceType.WAREHOUSE,
        config={"host": "warehouse", "port": 5432, "database": "analytics", "schema": "public"},
        description="Analytical data warehouse",
        tags=["warehouse", "analytics"],
    )
    data_sources[ds1.id] = ds1
    data_sources[ds2.id] = ds2
    data_sources[ds3.id] = ds3

    # Sample transformations
    t1 = Transformation(
        id="txn-001",
        name="Clean User Events",
        description="Filter and normalize user events",
        sql="""
        SELECT
            event_id,
            user_id,
            event_type,
            TO_TIMESTAMP(event_ts) as event_time,
            JSON_EXTRACT_PATH_TEXT(properties, 'page') as page,
            JSON_EXTRACT_PATH_TEXT(properties, 'action') as action
        FROM raw_events
        WHERE event_ts IS NOT NULL
        AND user_id IS NOT NULL
        """,
        input_schema={"event_id": "string", "user_id": "string", "event_type": "string", "event_ts": "bigint", "properties": "json"},
        output_schema={"event_id": "string", "user_id": "string", "event_type": "string", "event_time": "timestamp", "page": "string", "action": "string"},
    )
    t2 = Transformation(
        id="txn-002",
        name="Aggregate Daily Metrics",
        description="Compute daily aggregates from cleaned events",
        sql="""
        SELECT
            DATE(event_time) as date,
            COUNT(DISTINCT user_id) as dau,
            COUNT(*) as total_events,
            COUNT(DISTINCT CASE WHEN event_type = 'purchase' THEN user_id END) as purchasers,
            SUM(CASE WHEN event_type = 'purchase' THEN 1 ELSE 0 END) as purchases
        FROM cleaned_events
        GROUP BY 1
        """,
        input_schema={"event_time": "timestamp", "user_id": "string", "event_type": "string"},
        output_schema={"date": "date", "dau": "bigint", "total_events": "bigint", "purchasers": "bigint", "purchases": "bigint"},
    )
    transformations[t1.id] = t1
    transformations[t2.id] = t2

    # Sample pipeline
    p1 = Pipeline(
        id="pipe-001",
        name="Daily User Metrics",
        description="Compute daily user engagement metrics",
        source_ids=["src-002"],
        transformation_ids=["txn-001", "txn-002"],
        destination_id="src-003",
        schedule="0 2 * * *",  # 2 AM daily
        status=PipelineStatus.ACTIVE,
        tags=["daily", "metrics", "user"],
    )
    pipelines[p1.id] = p1


initialize_sample_data()


# ============================================
# MOCK PIPELINE EXECUTION
# ============================================

async def execute_pipeline_mock(pipeline: Pipeline, parameters: Dict[str, Any]) -> PipelineRun:
    """Mock pipeline execution."""
    run_id = f"run-{uuid.uuid4().hex[:12]}"
    run = PipelineRun(
        id=run_id,
        pipeline_id=pipeline.id,
        status=RunStatus.RUNNING,
        parameters=parameters,
        start_time=datetime.utcnow().isoformat(),
    )
    pipeline_runs[run_id] = run

    # Simulate execution steps
    steps = [
        "Extracting from sources...",
        "Applying transformations...",
        "Running quality checks...",
        "Loading to destination...",
    ]

    for i, step in enumerate(steps):
        await asyncio.sleep(0.3)
        run.logs.append(f"[{datetime.utcnow().isoformat()}] {step}")
        if i == 2:  # Quality check step
            run.rows_processed = 100000 + (i * 5000)
            run.bytes_processed = 50 * 1024 * 1024

    run.status = RunStatus.COMPLETED
    run.end_time = datetime.utcnow().isoformat()
    run.rows_processed = 125000
    run.bytes_processed = 62 * 1024 * 1024

    return run


# ============================================
# MCP SERVER
# ============================================

server = McpServer(
    name="data-pipeline",
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
    config: Dict[str, Any],
    description: str = "",
    schema: Optional[Dict[str, Any]] = None,
    tags: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Register a new data source."""
    ds_id = f"src-{uuid.uuid4().hex[:8]}"
    ds = DataSource(
        id=ds_id,
        name=name,
        type=SourceType(type),
        config=config,
        description=description,
        schema=schema,
        tags=tags or [],
    )
    data_sources[ds_id] = ds
    return ds.__dict__


@server.tool("list-data-sources", "List data sources")
async def list_data_sources(
    type: Optional[str] = None,
    active_only: bool = True,
) -> Dict[str, Any]:
    """List data sources."""
    result = list(data_sources.values())
    if active_only:
        result = [ds for ds in result if ds.is_active]
    if type:
        result = [ds for ds in result if ds.type.value == type]
    return {"data_sources": [ds.__dict__ for ds in result], "count": len(result)}


@server.tool("get-data-source", "Get data source")
async def get_data_source(data_source_id: str) -> Dict[str, Any]:
    """Get data source details."""
    ds = data_sources.get(data_source_id)
    if not ds:
        return {"error": "Data source not found", "data_source_id": data_source_id}
    return ds.__dict__


@server.tool("test-data-source", "Test data source connection")
async def test_data_source(data_source_id: str) -> Dict[str, Any]:
    """Test data source connectivity."""
    ds = data_sources.get(data_source_id)
    if not ds:
        return {"error": "Data source not found", "data_source_id": data_source_id}

    await asyncio.sleep(0.2)
    return {"success": True, "message": f"Connected to {ds.type.value} successfully", "latency_ms": 35}


@server.tool("preview-data-source", "Preview data from source")
async def preview_data_source(data_source_id: str, limit: int = 10) -> Dict[str, Any]:
    """Preview data from source."""
    ds = data_sources.get(data_source_id)
    if not ds:
        return {"error": "Data source not found", "data_source_id": data_source_id}

    # Mock preview data
    return {
        "data_source": ds.name,
        "columns": ["id", "name", "created_at", "status"],
        "rows": [[i, f"record_{i}", datetime.utcnow().isoformat(), "active"] for i in range(1, limit + 1)],
        "row_count": limit,
    }


# ============================================
# TOOLS - TRANSFORMATIONS
# ============================================

@server.tool("create-transformation", "Create a transformation")
async def create_transformation(
    name: str,
    description: str,
    sql: str = "",
    python: str = "",
    input_schema: Optional[Dict[str, Any]] = None,
    output_schema: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Create a data transformation."""
    txn_id = f"txn-{uuid.uuid4().hex[:8]}"
    txn = Transformation(
        id=txn_id,
        name=name,
        description=description,
        sql=sql,
        python=python,
        input_schema=input_schema or {},
        output_schema=output_schema or {},
    )
    transformations[txn_id] = txn
    return txn.__dict__


@server.tool("list-transformations", "List transformations")
async def list_transformations() -> Dict[str, Any]:
    """List all transformations."""
    return {"transformations": [t.__dict__ for t in transformations.values()], "count": len(transformations)}


@server.tool("get-transformation", "Get transformation")
async def get_transformation(transformation_id: str) -> Dict[str, Any]:
    """Get transformation details."""
    txn = transformations.get(transformation_id)
    if not txn:
        return {"error": "Transformation not found", "transformation_id": transformation_id}
    return txn.__dict__


# ============================================
# TOOLS - PIPELINES
# ============================================

@server.tool("create-pipeline", "Create a pipeline")
async def create_pipeline(
    name: str,
    description: str,
    source_ids: List[str],
    transformation_ids: List[str],
    destination_id: str,
    schedule: Optional[str] = None,
    config: Optional[Dict[str, Any]] = None,
    tags: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Create a data pipeline."""
    # Validate sources exist
    for sid in source_ids:
        if sid not in data_sources:
            return {"error": f"Source not found: {sid}"}

    # Validate transformations exist
    for tid in transformation_ids:
        if tid not in transformations:
            return {"error": f"Transformation not found: {tid}"}

    # Validate destination exists
    if destination_id not in data_sources:
        return {"error": f"Destination not found: {destination_id}"}

    pipe_id = f"pipe-{uuid.uuid4().hex[:8]}"
    pipeline = Pipeline(
        id=pipe_id,
        name=name,
        description=description,
        source_ids=source_ids,
        transformation_ids=transformation_ids,
        destination_id=destination_id,
        schedule=schedule,
        config=config or {},
        tags=tags or [],
    )
    pipelines[pipe_id] = pipeline
    return pipeline.__dict__


@server.tool("list-pipelines", "List pipelines")
async def list_pipelines(
    status: Optional[str] = None,
    tags: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """List pipelines."""
    result = list(pipelines.values())
    if status:
        result = [p for p in result if p.status.value == status]
    if tags:
        result = [p for p in result if any(t in p.tags for t in tags)]
    return {"pipelines": [p.__dict__ for p in result], "count": len(result)}


@server.tool("get-pipeline", "Get pipeline")
async def get_pipeline(pipeline_id: str) -> Dict[str, Any]:
    """Get pipeline details."""
    pipeline = pipelines.get(pipeline_id)
    if not pipeline:
        return {"error": "Pipeline not found", "pipeline_id": pipeline_id}
    return pipeline.__dict__


@server.tool("update-pipeline-status", "Update pipeline status")
async def update_pipeline_status(pipeline_id: str, status: str) -> Dict[str, Any]:
    """Update pipeline status."""
    pipeline = pipelines.get(pipeline_id)
    if not pipeline:
        return {"error": "Pipeline not found", "pipeline_id": pipeline_id}

    pipeline.status = PipelineStatus(status)
    pipeline.updated_at = datetime.utcnow().isoformat()
    return pipeline.__dict__


@server.tool("run-pipeline", "Execute a pipeline")
async def run_pipeline(pipeline_id: str, parameters: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Execute a pipeline."""
    pipeline = pipelines.get(pipeline_id)
    if not pipeline:
        return {"error": "Pipeline not found", "pipeline_id": pipeline_id}

    if pipeline.status != PipelineStatus.ACTIVE:
        return {"error": f"Pipeline is not active (status: {pipeline.status.value})"}

    run = await execute_pipeline_mock(pipeline, parameters or {})
    pipeline_runs[run.id] = run
    return run.__dict__


@server.tool("get-pipeline-run", "Get pipeline run")
async def get_pipeline_run(run_id: str) -> Dict[str, Any]:
    """Get pipeline run details."""
    run = pipeline_runs.get(run_id)
    if not run:
        return {"error": "Run not found", "run_id": run_id}
    return run.__dict__


@server.tool("list-pipeline-runs", "List pipeline runs")
async def list_pipeline_runs(
    pipeline_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50,
) -> Dict[str, Any]:
    """List pipeline runs."""
    result = list(pipeline_runs.values())
    if pipeline_id:
        result = [r for r in result if r.pipeline_id == pipeline_id]
    if status:
        result = [r for r in result if r.status.value == status]

    result.sort(key=lambda r: r.created_at, reverse=True)
    return {"runs": [r.__dict__ for r in result[:limit]], "total": len(result)}


@server.tool("cancel-pipeline-run", "Cancel pipeline run")
async def cancel_pipeline_run(run_id: str) -> Dict[str, Any]:
    """Cancel a running pipeline."""
    run = pipeline_runs.get(run_id)
    if not run:
        return {"error": "Run not found", "run_id": run_id}

    if run.status not in [RunStatus.PENDING, RunStatus.RUNNING]:
        return {"error": f"Cannot cancel run in {run.status.value} status"}

    run.status = RunStatus.CANCELLED
    run.end_time = datetime.utcnow().isoformat()
    run.logs.append(f"[{datetime.utcnow().isoformat()}] Cancelled by user")
    return {"success": True, "run": run.__dict__}


# ============================================
# TOOLS - DATA QUALITY
# ============================================

@server.tool("create-quality-check", "Create data quality check")
async def create_quality_check(
    name: str,
    description: str,
    pipeline_id: str,
    check_type: str,
    config: Dict[str, Any],
    threshold: float = 0.0,
    severity: str = "warning",
) -> Dict[str, Any]:
    """Create a data quality check."""
    if pipeline_id not in pipelines:
        return {"error": "Pipeline not found", "pipeline_id": pipeline_id}

    check_id = f"qc-{uuid.uuid4().hex[:8]}"
    check = DataQualityCheck(
        id=check_id,
        name=name,
        description=description,
        pipeline_id=pipeline_id,
        check_type=check_type,
        config=config,
        threshold=threshold,
        severity=severity,
    )
    quality_checks[check_id] = check
    return check.__dict__


@server.tool("run-quality-checks", "Run quality checks for pipeline")
async def run_quality_checks(pipeline_id: str, run_id: str) -> Dict[str, Any]:
    """Run all quality checks for a pipeline run."""
    pipeline = pipelines.get(pipeline_id)
    run = pipeline_runs.get(run_id)

    if not pipeline or not run:
        return {"error": "Pipeline or run not found"}

    checks = [c for c in quality_checks.values() if c.pipeline_id == pipeline_id and c.is_active]
    results = []

    for check in checks:
        # Mock quality check execution
        await asyncio.sleep(0.1)
        passed = True  # Mock
        value = 100000  # Mock

        results.append({
            "check_id": check.id,
            "check_name": check.name,
            "check_type": check.check_type,
            "passed": passed,
            "value": value,
            "threshold": check.threshold,
            "severity": check.severity,
        })

    return {"pipeline_id": pipeline_id, "run_id": run_id, "results": results, "all_passed": all(r["passed"] for r in results)}


# ============================================
# RESOURCES
# ============================================

@server.resource("datasource://{data_source_id}", "Data Source")
async def datasource_resource(data_source_id: str) -> Dict[str, Any]:
    """Data source resource."""
    ds = data_sources.get(data_source_id)
    if not ds:
        raise ValueError(f"Data source not found: {data_source_id}")
    return ds.__dict__


@server.resource("transformation://{transformation_id}", "Transformation")
async def transformation_resource(transformation_id: str) -> Dict[str, Any]:
    """Transformation resource."""
    txn = transformations.get(transformation_id)
    if not txn:
        raise ValueError(f"Transformation not found: {transformation_id}")
    return txn.__dict__


@server.resource("pipeline://{pipeline_id}", "Pipeline")
async def pipeline_resource(pipeline_id: str) -> Dict[str, Any]:
    """Pipeline resource."""
    pipeline = pipelines.get(pipeline_id)
    if not pipeline:
        raise ValueError(f"Pipeline not found: {pipeline_id}")
    return pipeline.__dict__


@server.resource("pipeline://{pipeline_id}/runs", "Pipeline Runs")
async def pipeline_runs_resource(pipeline_id: str) -> Dict[str, Any]:
    """Pipeline runs resource."""
    runs = [r for r in pipeline_runs.values() if r.pipeline_id == pipeline_id]
    runs.sort(key=lambda r: r.created_at, reverse=True)
    return {"pipeline_id": pipeline_id, "runs": [r.__dict__ for r in runs[:20]]}


@server.resource("run://{run_id}", "Pipeline Run")
async def run_resource(run_id: str) -> Dict[str, Any]:
    """Pipeline run resource."""
    run = pipeline_runs.get(run_id)
    if not run:
        raise ValueError(f"Run not found: {run_id}")
    return run.__dict__


@server.resource("quality://{pipeline_id}/checks", "Quality Checks")
async def quality_checks_resource(pipeline_id: str) -> Dict[str, Any]:
    """Quality checks resource."""
    checks = [c for c in quality_checks.values() if c.pipeline_id == pipeline_id]
    return {"pipeline_id": pipeline_id, "checks": [c.__dict__ for c in checks]}


# ============================================
# PROMPTS
# ============================================

@server.prompt("pipeline-design", "Design a data pipeline")
async def pipeline_design_prompt(
    business_requirement: str,
    source_systems: List[str],
    destination: str,
    frequency: str = "daily",
    sla: str = "2 hours",
) -> Dict[str, Any]:
    """Design a data pipeline prompt."""
    prompt = f"""Design a data pipeline for: {business_requirement}

Source Systems: {', '.join(source_systems)}
Destination: {destination}
Frequency: {frequency}
SLA: {sla}

Provide:
1. Architecture diagram (text description)
2. Source extraction strategy
3. Transformation logic
4. Loading strategy (full/incremental)
5. Error handling & retries
6. Monitoring & alerting
7. Data quality checks
8. Capacity planning
9. Cost estimation"""

    return {
        "messages": [
            {"role": "system", "content": "You are a data engineering architect. Design scalable, reliable pipelines."},
            {"role": "user", "content": prompt},
        ]
    }


@server.prompt("debug-pipeline", "Debug pipeline failure")
async def debug_pipeline_prompt(
    pipeline_id: str,
    run_id: str,
    error_message: str,
    logs: List[str],
) -> Dict[str, Any]:
    """Debug pipeline failure prompt."""
    pipeline = pipelines.get(pipeline_id)
    run = pipeline_runs.get(run_id)

    prompt = f"""Debug this pipeline failure:

Pipeline: {pipeline.name if pipeline else pipeline_id}
Run: {run_id}
Error: {error_message}

Recent Logs:
{chr(10).join(logs[-20:])}

Analyze:
1. Root cause of failure
2. Affected stage
3. Recovery steps
4. Prevention measures
5. Whether to retry or fix first"""

    return {
        "messages": [
            {"role": "system", "content": "You are a data engineer debugging pipeline failures. Be systematic and practical."},
            {"role": "user", "content": prompt},
        ]
    }


@server.prompt("optimize-pipeline", "Optimize pipeline performance")
async def optimize_pipeline_prompt(
    pipeline_id: str,
    current_runtime: str,
    target_runtime: str,
    bottleneck: str = "",
) -> Dict[str, Any]:
    """Optimize pipeline performance prompt."""
    pipeline = pipelines.get(pipeline_id)

    prompt = f"""Optimize pipeline performance:

Pipeline: {pipeline.name if pipeline else pipeline_id}
Current Runtime: {current_runtime}
Target Runtime: {target_runtime}
Known Bottleneck: {bottleneck or 'Unknown'}

Transformations: {[t.name for t in transformations.values() if t.id in (pipeline.transformation_ids if pipeline else [])]}

Provide:
1. Performance analysis
2. Specific optimizations (partitioning, indexing, parallelization, etc.)
3. Resource scaling recommendations
4. Code-level improvements
5. Trade-offs and risks"""

    return {
        "messages": [
            {"role": "system", "content": "You are a performance optimization expert. Provide actionable, measurable recommendations."},
            {"role": "user", "content": prompt},
        ]
    }


# ============================================
# HEALTH CHECK
# ============================================

@server.tool("health", "Health check")
async def health() -> Dict[str, Any]:
    """Health check endpoint."""
    active_pipelines = sum(1 for p in pipelines.values() if p.status == PipelineStatus.ACTIVE)
    running_runs = sum(1 for r in pipeline_runs.values() if r.status == RunStatus.RUNNING)

    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "data_sources": len(data_sources),
        "transformations": len(transformations),
        "pipelines": {"total": len(pipelines), "active": active_pipelines},
        "runs": {"total": len(pipeline_runs), "running": running_runs},
        "quality_checks": len(quality_checks),
    }


# ============================================
# MAIN
# ============================================

async def main():
    transport = os.getenv("MCP_TRANSPORT", "websocket")
    port = int(os.getenv("MCP_PORT", "3000"))
    host = os.getenv("MCP_HOST", "0.0.0.0")

    print(f"Starting data-pipeline on {transport}...", file=sys.stderr)

    if transport == "websocket":
        await server.start(transport="websocket", port=port, host=host)
    elif transport == "http-sse":
        await server.start(transport="http-sse", port=port, host=host)
    elif transport == "grpc":
        await server.start(transport="grpc", port=port, host=host)
    else:
        await server.start(transport="stdio")

    print("Data pipeline server started", file=sys.stderr)


if __name__ == "__main__":
    import sys
    asyncio.run(main())
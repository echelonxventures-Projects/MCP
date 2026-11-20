"""
Data Pipeline MCP Server
ETL tools, dataset resources, and transformation prompts
"""

from mcp_server import McpServer, tool, resource, prompt
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
import asyncio
import os
import json
from datetime import datetime
from enum import Enum
import uuid


# Create MCP server instance
server = McpServer(
    name="data-pipeline",
    version="1.0.0",
    capabilities={
        "tools": {"listChanged": True},
        "resources": {"subscribe": True, "listChanged": True},
        "prompts": {"listChanged": True},
        "logging": {},
    }
)


# Pydantic models
class DataSourceType(str, Enum):
    POSTGRESQL = "postgresql"
    MYSQL = "mysql"
    BIGQUERY = "bigquery"
    SNOWFLAKE = "snowflake"
    CSV = "csv"
    PARQUET = "parquet"
    S3 = "s3"


class PipelineStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class DataSourceConfig(BaseModel):
    name: str = Field(description="Data source name")
    type: DataSourceType = Field(description="Data source type")
    config: Dict[str, Any] = Field(description="Connection configuration")


class PipelineStep(BaseModel):
    name: str = Field(description="Step name")
    type: str = Field(description="Step type: extract, transform, load")
    config: Dict[str, Any] = Field(description="Step configuration")
    depends_on: Optional[List[str]] = Field(default=None, description="Dependent step names")


class PipelineConfig(BaseModel):
    name: str = Field(description="Pipeline name")
    description: Optional[str] = Field(default=None, description="Pipeline description")
    steps: List[PipelineStep] = Field(description="Pipeline steps")
    schedule: Optional[str] = Field(default=None, description="Cron schedule")


class ExecutePipelineParams(BaseModel):
    pipeline_id: str = Field(description="Pipeline ID")
    parameters: Optional[Dict[str, Any]] = Field(default=None, description="Runtime parameters")


# In-memory stores (replace with persistent storage)
data_sources: Dict[str, DataSourceConfig] = {}
pipelines: Dict[str, PipelineConfig] = {}
pipeline_runs: Dict[str, Dict[str, Any]] = {}


# Initialize sample data
def initialize_sample_data():
    # Sample data source
    ds = DataSourceConfig(
        name="PostgreSQL Warehouse",
        type=DataSourceType.POSTGRESQL,
        config={"host": "localhost", "port": 5432, "database": "warehouse", "user": "admin"},
    )
    data_sources[f"ds-{uuid.uuid4().hex[:8]}"] = ds

    # Sample pipeline
    pipeline = PipelineConfig(
        name="Daily ETL",
        description="Extract from source, transform, load to warehouse",
        steps=[
            PipelineStep(name="extract_users", type="extract", config={"source": "users_table", "query": "SELECT * FROM users WHERE updated_at > $1"}),
            PipelineStep(name="transform_users", type="transform", config={"operation": "clean_and_enrich", "depends_on": ["extract_users"]}),
            PipelineStep(name="load_users", type="load", config={"target": "warehouse.users", "mode": "upsert", "depends_on": ["transform_users"]}),
        ],
        schedule="0 2 * * *",  # Daily at 2 AM
    )
    pipelines[f"pipe-{uuid.uuid4().hex[:8]}"] = pipeline


initialize_sample_data()


# ============================================
# TOOLS
# ============================================

@server.tool("create-data-source", "Create a new data source connection")
async def create_data_source(params: DataSourceConfig) -> dict:
    ds_id = f"ds-{uuid.uuid4().hex[:8]}"
    data_sources[ds_id] = params
    return {"content": [{"type": "text", "text": json.dumps({"id": ds_id, **params.model_dump()}, indent=2)}]}


@server.tool("list-data-sources", "List all configured data sources")
async def list_data_sources() -> dict:
    return {
        "content": [{
            "type": "text",
            "text": json.dumps({
                "dataSources": [{"id": k, **v.model_dump()} for k, v in data_sources.items()]
            }, indent=2),
        }],
    }


@server.tool("test-data-source", "Test data source connection")
async def test_data_source(data_source_id: str = Field(description="Data source ID")) -> dict:
    if data_source_id not in data_sources:
        return {"content": [{"type": "text", "text": json.dumps({"error": "Data source not found"})}], "isError": True}

    # Mock connection test
    return {"content": [{"type": "text", "text": json.dumps({"success": True, "status": "connected"}, indent=2)}]}


@server.tool("create-pipeline", "Create a new ETL pipeline")
async def create_pipeline(params: PipelineConfig) -> dict:
    pipe_id = f"pipe-{uuid.uuid4().hex[:8]}"
    pipelines[pipe_id] = params
    return {"content": [{"type": "text", "text": json.dumps({"id": pipe_id, **params.model_dump()}, indent=2)}]}


@server.tool("list-pipelines", "List all pipelines")
async def list_pipelines() -> dict:
    return {
        "content": [{
            "type": "text",
            "text": json.dumps({
                "pipelines": [{"id": k, **v.model_dump()} for k, v in pipelines.items()]
            }, indent=2),
        }],
    }


@server.tool("execute-pipeline", "Execute a pipeline")
async def execute_pipeline(params: ExecutePipelineParams) -> dict:
    if params.pipeline_id not in pipelines:
        return {"content": [{"type": "text", "text": json.dumps({"error": "Pipeline not found"})}], "isError": True}

    pipeline = pipelines[params.pipeline_id]
    run_id = f"run-{uuid.uuid4().hex[:8]}"

    run = {
        "id": run_id,
        "pipeline_id": params.pipeline_id,
        "pipeline_name": pipeline.name,
        "status": PipelineStatus.RUNNING,
        "started_at": datetime.utcnow().isoformat(),
        "completed_at": None,
        "parameters": params.parameters or {},
        "steps": [],
    }

    # Simulate execution
    for step in pipeline.steps:
        step_result = {
            "name": step.name,
            "type": step.type,
            "status": PipelineStatus.COMPLETED,
            "started_at": datetime.utcnow().isoformat(),
            "completed_at": datetime.utcnow().isoformat(),
            "records_processed": 1000,
            "output": f"Processed {step.name}",
        }
        run["steps"].append(step_result)

    run["status"] = PipelineStatus.COMPLETED
    run["completed_at"] = datetime.utcnow().isoformat()
    pipeline_runs[run_id] = run

    return {"content": [{"type": "text", "text": json.dumps(run, indent=2)}]}


@server.tool("get-pipeline-run", "Get pipeline run details")
async def get_pipeline_run(run_id: str = Field(description="Run ID")) -> dict:
    if run_id not in pipeline_runs:
        return {"content": [{"type": "text", "text": json.dumps({"error": "Run not found"})}], "isError": True}

    return {"content": [{"type": "text", "text": json.dumps(pipeline_runs[run_id], indent=2)}]}


@server.tool("list-pipeline-runs", "List pipeline runs")
async def list_pipeline_runs(pipeline_id: Optional[str] = Field(default=None, description="Filter by pipeline ID")) -> dict:
    runs = list(pipeline_runs.values())
    if pipeline_id:
        runs = [r for r in runs if r["pipeline_id"] == pipeline_id]

    return {
        "content": [{
            "type": "text",
            "text": json.dumps({"runs": runs}, indent=2),
        }],
    }


@server.tool("execute-sql", "Execute SQL against a data source")
async def execute_sql(
    data_source_id: str = Field(description="Data source ID"),
    sql: str = Field(description="SQL query"),
    parameters: Optional[Dict[str, Any]] = Field(default=None, description="Query parameters"),
) -> dict:
    if data_source_id not in data_sources:
        return {"content": [{"type": "text", "text": json.dumps({"error": "Data source not found"})}], "isError": True}

    # Mock execution
    return {
        "content": [{
            "type": "text",
            "text": json.dumps({
                "message": "SQL execution not implemented in mock",
                "sql": sql,
                "dataSourceId": data_source_id,
            }, indent=2),
        }],
    }


@server.tool("get-schema", "Get database schema information")
async def get_schema(
    data_source_id: str = Field(description="Data source ID"),
    schema_name: Optional[str] = Field(default=None, description="Schema name"),
) -> dict:
    if data_source_id not in data_sources:
        return {"content": [{"type": "text", "text": json.dumps({"error": "Data source not found"})}], "isError": True}

    return {
        "content": [{
            "type": "text",
            "text": json.dumps({
                "dataSource": data_sources[data_source_id].name,
                "schemas": [
                    {"name": schema_name or "public", "tables": ["users", "orders", "products", "events"]},
                ],
            }, indent=2),
        }],
    }


# ============================================
# RESOURCES
# ============================================

@server.resource("pipeline://{pipeline_id}", "Pipeline configuration")
async def pipeline_resource(uri) -> dict:
    pipeline_id = uri.params["pipeline_id"]
    if pipeline_id not in pipelines:
        raise ValueError(f"Pipeline not found: {pipeline_id}")

    return {
        "contents": [{
            "uri": str(uri),
            "mimeType": "application/json",
            "text": json.dumps({"id": pipeline_id, **pipelines[pipeline_id].model_dump()}, indent=2),
        }],
    }


@server.resource("pipeline-run://{run_id}", "Pipeline run details")
async def pipeline_run_resource(uri) -> dict:
    run_id = uri.params["run_id"]
    if run_id not in pipeline_runs:
        raise ValueError(f"Run not found: {run_id}")

    return {
        "contents": [{
            "uri": str(uri),
            "mimeType": "application/json",
            "text": json.dumps(pipeline_runs[run_id], indent=2),
        }],
    }


@server.resource("data-source://{data_source_id}", "Data source configuration")
async def data_source_resource(uri) -> dict:
    ds_id = uri.params["data_source_id"]
    if ds_id not in data_sources:
        raise ValueError(f"Data source not found: {ds_id}")

    return {
        "contents": [{
            "uri": str(uri),
            "mimeType": "application/json",
            "text": json.dumps({"id": ds_id, **data_sources[ds_id].model_dump()}, indent=2),
        }],
    }


# ============================================
# PROMPTS
# ============================================

class PipelineDebugParams(BaseModel):
    run_id: str = Field(description="Pipeline run ID")


@server.prompt("debug-pipeline", "Debug a failed pipeline run")
async def debug_pipeline(params: PipelineDebugParams) -> dict:
    if params.run_id not in pipeline_runs:
        return {
            "messages": [
                {"role": "system", "content": "You are a data engineering assistant."},
                {"role": "user", "content": f"Run {params.run_id} not found."},
            ],
        }

    run = pipeline_runs[params.run_id]

    return {
        "messages": [
            {
                "role": "system",
                "content": "You are a data engineering expert. Analyze the failed pipeline run and provide debugging guidance.",
            },
            {
                "role": "user",
                "content": f"Pipeline: {run['pipeline_name']}\nRun ID: {run['id']}\nStatus: {run['status']}\nSteps: {json.dumps(run['steps'], indent=2)}\n\nProvide debugging steps and potential fixes.",
            },
        ],
    }


class OptimizePipelineParams(BaseModel):
    pipeline_id: str = Field(description="Pipeline ID")


@server.prompt("optimize-pipeline", "Get pipeline optimization suggestions")
async def optimize_pipeline(params: OptimizePipelineParams) -> dict:
    if params.pipeline_id not in pipelines:
        return {
            "messages": [
                {"role": "system", "content": "You are a data engineering expert."},
                {"role": "user", "content": f"Pipeline {params.pipeline_id} not found."},
            ],
        }

    pipeline = pipelines[params.pipeline_id]

    return {
        "messages": [
            {
                "role": "system",
                "content": "You are a data engineering expert. Analyze the pipeline and provide optimization recommendations for performance, reliability, and maintainability.",
            },
            {
                "role": "user",
                "content": f"Pipeline: {pipeline.name}\nDescription: {pipeline.description}\nSteps: {json.dumps([s.model_dump() for s in pipeline.steps], indent=2)}\nSchedule: {pipeline.schedule}\n\nProvide optimization suggestions.",
            },
        ],
    }


# ============================================
# HEALTH CHECK
# ============================================

@server.tool("health", "Health check endpoint")
async def health() -> dict:
    return {
        "content": [{
            "type": "text",
            "text": json.dumps({
                "status": "healthy",
                "timestamp": datetime.utcnow().isoformat(),
                "dataSources": len(data_sources),
                "pipelines": len(pipelines),
                "activeRuns": len([r for r in pipeline_runs.values() if r["status"] == PipelineStatus.RUNNING]),
            }, indent=2),
        }],
    }


async def main():
    transport = os.getenv("MCP_TRANSPORT", "stdio")
    port = int(os.getenv("MCP_PORT", "3000"))
    host = os.getenv("MCP_HOST", "0.0.0.0")

    print(f"Starting data-pipeline on {transport}...", file=__import__("sys").stderr)

    if transport == "websocket":
        await server.start(transport="websocket", port=port, host=host)
    elif transport == "http-sse":
        await server.start(transport="http-sse", port=port, host=host)
    elif transport == "grpc":
        await server.start(transport="grpc", port=port, host=host)
    else:
        await server.start(transport="stdio")

    print("Data pipeline server started successfully", file=__import__("sys").stderr)


if __name__ == "__main__":
    asyncio.run(main())
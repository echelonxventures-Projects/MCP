"""
ML Model Server MCP Server
Inference tools, model registry, and experiment tracking
"""

from mcp_server import McpServer, tool, resource, prompt
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any, Union
import asyncio
import os
import json
from datetime import datetime
from enum import Enum
import uuid
import base64
import io


# Create MCP server instance
server = McpServer(
    name="ml-model-server",
    version="1.0.0",
    capabilities={
        "tools": {"listChanged": True},
        "resources": {"subscribe": True, "listChanged": True},
        "prompts": {"listChanged": True},
        "logging": {},
    }
)


# Pydantic models
class ModelType(str, Enum):
    PYTORCH = "pytorch"
    TENSORFLOW = "tensorflow"
    ONNX = "onnx"
    SKLEARN = "sklearn"
    HUGGINGFACE = "huggingface"
    CUSTOM = "custom"


class ModelStatus(str, Enum):
    LOADING = "loading"
    READY = "ready"
    ERROR = "error"
    UNLOADED = "unloaded"


class ModelConfig(BaseModel):
    name: str = Field(description="Model name")
    version: str = Field(description="Model version")
    type: ModelType = Field(description="Model framework")
    path: str = Field(description="Model path or identifier")
    config: Optional[Dict[str, Any]] = Field(default=None, description="Model configuration")
    metadata: Optional[Dict[str, Any]] = Field(default=None, description="Additional metadata")


class InferenceRequest(BaseModel):
    model_id: str = Field(description="Model ID")
    inputs: Union[List[Any], Dict[str, Any], str] = Field(description="Model inputs")
    parameters: Optional[Dict[str, Any]] = Field(default=None, description="Inference parameters")


class BatchInferenceRequest(BaseModel):
    model_id: str = Field(description="Model ID")
    inputs_batch: List[Union[List[Any], Dict[str, Any], str]] = Field(description="Batch of inputs")
    parameters: Optional[Dict[str, Any]] = Field(default=None, description="Inference parameters")


class ExperimentConfig(BaseModel):
    name: str = Field(description="Experiment name")
    description: Optional[str] = Field(default=None, description="Experiment description")
    tags: Optional[Dict[str, str]] = Field(default=None, description="Experiment tags")


# In-memory stores
models: Dict[str, Dict[str, Any]] = {}
experiments: Dict[str, Dict[str, Any]] = {}
runs: Dict[str, Dict[str, Any]] = {}


# Initialize sample data
def initialize_sample_data():
    # Sample model
    model_id = f"model-{uuid.uuid4().hex[:8]}"
    models[model_id] = {
        "id": model_id,
        "name": "bert-base-uncased",
        "version": "1.0.0",
        "type": ModelType.HUGGINGFACE,
        "path": "bert-base-uncased",
        "status": ModelStatus.READY,
        "config": {"task": "text-classification", "num_labels": 2},
        "metadata": {"framework": "transformers", "size": "110M"},
        "loaded_at": datetime.utcnow().isoformat(),
        "request_count": 0,
    }

    # Sample experiment
    exp_id = f"exp-{uuid.uuid4().hex[:8]}"
    experiments[exp_id] = {
        "id": exp_id,
        "name": "sentiment-analysis-v1",
        "description": "Fine-tuning BERT for sentiment analysis",
        "tags": {"task": "nlp", "dataset": "imdb"},
        "created_at": datetime.utcnow().isoformat(),
    }


initialize_sample_data()


# ============================================
# TOOLS
# ============================================

@server.tool("register-model", "Register a new model")
async def register_model(params: ModelConfig) -> dict:
    model_id = f"model-{uuid.uuid4().hex[:8]}"
    model = {
        "id": model_id,
        **params.model_dump(),
        "status": ModelStatus.UNLOADED,
        "loaded_at": None,
        "request_count": 0,
    }
    models[model_id] = model
    return {"content": [{"type": "text", "text": json.dumps(model, indent=2)}]}


@server.tool("load-model", "Load a model into memory")
async def load_model(model_id: str = Field(description="Model ID")) -> dict:
    if model_id not in models:
        return {"content": [{"type": "text", "text": json.dumps({"error": "Model not found"})}], "isError": True}

    model = models[model_id]
    model["status"] = ModelStatus.LOADING

    # Simulate loading
    await asyncio.sleep(0.1)

    model["status"] = ModelStatus.READY
    model["loaded_at"] = datetime.utcnow().isoformat()

    return {"content": [{"type": "text", "text": json.dumps(model, indent=2)}]}


@server.tool("unload-model", "Unload a model from memory")
async def unload_model(model_id: str = Field(description="Model ID")) -> dict:
    if model_id not in models:
        return {"content": [{"type": "text", "text": json.dumps({"error": "Model not found"})}], "isError": True}

    models[model_id]["status"] = ModelStatus.UNLOADED
    models[model_id]["loaded_at"] = None

    return {"content": [{"type": "text", "text": json.dumps(models[model_id], indent=2)}]}


@server.tool("list-models", "List all registered models")
async def list_models() -> dict:
    return {
        "content": [{
            "type": "text",
            "text": json.dumps({"models": list(models.values())}, indent=2),
        }],
    }


@server.tool("get-model", "Get model details")
async def get_model(model_id: str = Field(description="Model ID")) -> dict:
    if model_id not in models:
        return {"content": [{"type": "text", "text": json.dumps({"error": "Model not found"})}], "isError": True}

    return {"content": [{"type": "text", "text": json.dumps(models[model_id], indent=2)}]}


@server.tool("predict", "Run inference on a model")
async def predict(params: InferenceRequest) -> dict:
    if params.model_id not in models:
        return {"content": [{"type": "text", "text": json.dumps({"error": "Model not found"})}], "isError": True}

    model = models[params.model_id]
    if model["status"] != ModelStatus.READY:
        return {"content": [{"type": "text", "text": json.dumps({"error": f"Model not ready: {model['status']}"})}], "isError": True}

    # Mock inference
    model["request_count"] += 1

    # Simulate processing
    await asyncio.sleep(0.01)

    # Return mock prediction based on model type
    if model["type"] == ModelType.HUGGINGFACE:
        predictions = [{"label": "POSITIVE", "score": 0.95}, {"label": "NEGATIVE", "score": 0.05}]
    elif model["type"] == ModelType.ONNX:
        predictions = [[0.1, 0.2, 0.7]]
    else:
        predictions = [0.85]

    return {
        "content": [{
            "type": "text",
            "text": json.dumps({
                "model_id": params.model_id,
                "predictions": predictions,
                "latency_ms": 10,
            }, indent=2),
        }],
    }


@server.tool("batch-predict", "Run batch inference on a model")
async def batch_predict(params: BatchInferenceRequest) -> dict:
    if params.model_id not in models:
        return {"content": [{"type": "text", "text": json.dumps({"error": "Model not found"})}], "isError": True}

    model = models[params.model_id]
    if model["status"] != ModelStatus.READY:
        return {"content": [{"type": "text", "text": json.dumps({"error": f"Model not ready: {model['status']}"})}], "isError": True}

    model["request_count"] += len(params.inputs_batch)

    # Mock batch predictions
    predictions = []
    for _ in params.inputs_batch:
        if model["type"] == ModelType.HUGGINGFACE:
            predictions.append([{"label": "POSITIVE", "score": 0.95}, {"label": "NEGATIVE", "score": 0.05}])
        else:
            predictions.append([0.85])

    return {
        "content": [{
            "type": "text",
            "text": json.dumps({
                "model_id": params.model_id,
                "predictions": predictions,
                "batch_size": len(params.inputs_batch),
                "latency_ms": 50,
            }, indent=2),
        }],
    }


@server.tool("create-experiment", "Create a new ML experiment")
async def create_experiment(params: ExperimentConfig) -> dict:
    exp_id = f"exp-{uuid.uuid4().hex[:8]}"
    experiment = {
        "id": exp_id,
        **params.model_dump(),
        "created_at": datetime.utcnow().isoformat(),
    }
    experiments[exp_id] = experiment
    return {"content": [{"type": "text", "text": json.dumps(experiment, indent=2)}]}


@server.tool("list-experiments", "List all experiments")
async def list_experiments() -> dict:
    return {
        "content": [{
            "type": "text",
            "text": json.dumps({"experiments": list(experiments.values())}, indent=2),
        }],
    }


@server.tool("start-run", "Start a new experiment run")
async def start_run(
    experiment_id: str = Field(description="Experiment ID"),
    run_name: Optional[str] = Field(default=None, description="Run name"),
    params: Optional[Dict[str, Any]] = Field(default=None, description="Run parameters"),
) -> dict:
    if experiment_id not in experiments:
        return {"content": [{"type": "text", "text": json.dumps({"error": "Experiment not found"})}], "isError": True}

    run_id = f"run-{uuid.uuid4().hex[:8]}"
    run = {
        "id": run_id,
        "experiment_id": experiment_id,
        "name": run_name or f"run-{run_id[:8]}",
        "status": "running",
        "params": params or {},
        "metrics": {},
        "artifacts": [],
        "started_at": datetime.utcnow().isoformat(),
        "ended_at": None,
    }
    runs[run_id] = run
    return {"content": [{"type": "text", "text": json.dumps(run, indent=2)}]}


@server.tool("log-metric", "Log a metric for a run")
async def log_metric(
    run_id: str = Field(description="Run ID"),
    key: str = Field(description="Metric name"),
    value: float = Field(description="Metric value"),
    step: Optional[int] = Field(default=None, description="Step number"),
) -> dict:
    if run_id not in runs:
        return {"content": [{"type": "text", "text": json.dumps({"error": "Run not found"})}], "isError": True}

    runs[run_id]["metrics"][key] = {"value": value, "step": step, "timestamp": datetime.utcnow().isoformat()}
    return {"content": [{"type": "text", "text": json.dumps({"success": True}, indent=2)}]}


@server.tool("end-run", "End an experiment run")
async def end_run(
    run_id: str = Field(description="Run ID"),
    status: str = Field(default="completed", description="Run status"),
) -> dict:
    if run_id not in runs:
        return {"content": [{"type": "text", "text": json.dumps({"error": "Run not found"})}], "isError": True}

    runs[run_id]["status"] = status
    runs[run_id]["ended_at"] = datetime.utcnow().isoformat()
    return {"content": [{"type": "text", "text": json.dumps(runs[run_id], indent=2)}]}


# ============================================
# RESOURCES
# ============================================

@server.resource("model://{model_id}", "Model information")
async def model_resource(uri) -> dict:
    model_id = uri.params["model_id"]
    if model_id not in models:
        raise ValueError(f"Model not found: {model_id}")

    return {
        "contents": [{
            "uri": str(uri),
            "mimeType": "application/json",
            "text": json.dumps(models[model_id], indent=2),
        }],
    }


@server.resource("experiment://{experiment_id}", "Experiment information")
async def experiment_resource(uri) -> dict:
    exp_id = uri.params["experiment_id"]
    if exp_id not in experiments:
        raise ValueError(f"Experiment not found: {exp_id}")

    # Include runs
    exp_runs = [r for r in runs.values() if r["experiment_id"] == exp_id]

    return {
        "contents": [{
            "uri": str(uri),
            "mimeType": "application/json",
            "text": json.dumps({**experiments[exp_id], "runs": exp_runs}, indent=2),
        }],
    }


@server.resource("run://{run_id}", "Experiment run details")
async def run_resource(uri) -> dict:
    run_id = uri.params["run_id"]
    if run_id not in runs:
        raise ValueError(f"Run not found: {run_id}")

    return {
        "contents": [{
            "uri": str(uri),
            "mimeType": "application/json",
            "text": json.dumps(runs[run_id], indent=2),
        }],
    }


# ============================================
# PROMPTS
# ============================================

class ModelSelectionParams(BaseModel):
    task: str = Field(description="ML task (e.g., text-classification, object-detection)")
    requirements: Optional[str] = Field(default=None, description="Requirements (latency, accuracy, size)")


@server.prompt("select-model", "Get model selection recommendations")
async def select_model(params: ModelSelectionParams) -> dict:
    return {
        "messages": [
            {
                "role": "system",
                "content": "You are an ML engineer. Recommend suitable models based on the task and requirements.",
            },
            {
                "role": "user",
                "content": f"Task: {params.task}\nRequirements: {params.requirements or 'None specified'}\n\nRecommend models with pros/cons for each.",
            },
        ],
    }


class ExperimentDesignParams(BaseModel):
    problem: str = Field(description="Problem statement")
    data_description: str = Field(description="Description of available data")
    constraints: Optional[str] = Field(default=None, description="Constraints (time, compute, budget)")


@server.prompt("design-experiment", "Design an ML experiment")
async def design_experiment(params: ExperimentDesignParams) -> dict:
    return {
        "messages": [
            {
                "role": "system",
                "content": "You are an ML researcher. Design a comprehensive experiment plan.",
            },
            {
                "role": "user",
                "content": f"Problem: {params.problem}\nData: {params.data_description}\nConstraints: {params.constraints or 'None'}\n\nProvide: 1) Hypothesis, 2) Methodology, 3) Metrics, 4) Baselines, 5) Timeline.",
            },
        ],
    }


# ============================================
# HEALTH CHECK
# ============================================

@server.tool("health", "Health check endpoint")
async def health() -> dict:
    ready_models = len([m for m in models.values() if m["status"] == ModelStatus.READY])
    return {
        "content": [{
            "type": "text",
            "text": json.dumps({
                "status": "healthy",
                "timestamp": datetime.utcnow().isoformat(),
                "models": len(models),
                "readyModels": ready_models,
                "experiments": len(experiments),
                "activeRuns": len([r for r in runs.values() if r["status"] == "running"]),
            }, indent=2),
        }],
    }


async def main():
    transport = os.getenv("MCP_TRANSPORT", "stdio")
    port = int(os.getenv("MCP_PORT", "3000"))
    host = os.getenv("MCP_HOST", "0.0.0.0")

    print(f"Starting ml-model-server on {transport}...", file=__import__("sys").stderr)

    if transport == "websocket":
        await server.start(transport="websocket", port=port, host=host)
    elif transport == "http-sse":
        await server.start(transport="http-sse", port=port, host=host)
    elif transport == "grpc":
        await server.start(transport="grpc", port=port, host=host)
    else:
        await server.start(transport="stdio")

    print("ML model server started successfully", file=__import__("sys").stderr)


if __name__ == "__main__":
    asyncio.run(main())
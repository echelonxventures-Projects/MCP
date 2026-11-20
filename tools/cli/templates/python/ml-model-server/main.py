#!/usr/bin/env python3
"""
ML Model Server MCP Server
Model registry, inference, batch prediction, and experiment tracking
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

class ModelType(str, Enum):
    PYTORCH = "pytorch"
    TENSORFLOW = "tensorflow"
    ONNX = "onnx"
    SKLEARN = "sklearn"
    HUGGINGFACE = "huggingface"
    CUSTOM = "custom"


class ModelStatus(str, Enum):
    UNLOADED = "unloaded"
    LOADING = "loading"
    READY = "ready"
    ERROR = "error"


class RunStatus(str, Enum):
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class Model:
    id: str
    name: str
    version: str
    type: ModelType
    path: str  # Model file path or HuggingFace model ID
    config: Dict[str, Any] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)
    status: ModelStatus = ModelStatus.UNLOADED
    loaded_at: Optional[str] = None
    request_count: int = 0
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())


@dataclass
class Experiment:
    id: str
    name: str
    description: str = ""
    tags: Dict[str, str] = field(default_factory=dict)
    created_by: str = ""
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())


@dataclass
class Run:
    id: str
    experiment_id: str
    name: str
    status: RunStatus = RunStatus.RUNNING
    params: Dict[str, Any] = field(default_factory=dict)
    metrics: Dict[str, List[Dict[str, Any]]] = field(default_factory=dict)  # metric_name -> [{value, step, timestamp}]
    artifacts: List[str] = field(default_factory=list)
    started_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    ended_at: Optional[str] = None


# ============================================
# IN-MEMORY STORES
# ============================================

models: Dict[str, Model] = {}
experiments: Dict[str, Experiment] = {}
runs: Dict[str, Run] = {}


def initialize_sample_data():
    """Initialize sample ML data."""
    model = Model(
        id="model-001",
        name="bert-base-uncased",
        version="1.0.0",
        type=ModelType.HUGGINGFACE,
        path="bert-base-uncased",
        status=ModelStatus.READY,
        config={"task": "text-classification", "num_labels": 2},
        metadata={"framework": "transformers", "size": "110M"},
        loaded_at=datetime.utcnow().isoformat(),
    )
    models[model.id] = model

    exp = Experiment(
        id="exp-001",
        name="sentiment-analysis-v1",
        description="Fine-tuning BERT for sentiment analysis",
        tags={"task": "nlp", "dataset": "imdb"},
    )
    experiments[exp.id] = exp


initialize_sample_data()


# ============================================
# MOCK INFERENCE
# ============================================

async def run_inference_mock(model: Model, inputs: Any) -> Any:
    """Mock model inference."""
    await asyncio.sleep(0.01)  # Simulate inference time

    if model.type == ModelType.HUGGINGFACE:
        if isinstance(inputs, str):
            inputs = [inputs]
        return [[{"label": "POSITIVE", "score": 0.95}, {"label": "NEGATIVE", "score": 0.05}] for _ in inputs]
    elif model.type == ModelType.ONNX:
        return [[0.1, 0.2, 0.7] for _ in (inputs if isinstance(inputs, list) else [inputs])]
    else:
        return [[0.85] for _ in (inputs if isinstance(inputs, list) else [inputs])]


# ============================================
# MCP SERVER
# ============================================

server = McpServer(
    name="ml-model-server",
    version="1.0.0",
    capabilities={
        "tools": {"listChanged": True},
        "resources": {"subscribe": True, "listChanged": True},
        "prompts": {"listChanged": True},
        "logging": {},
    },
)


# ============================================
# TOOLS - MODEL REGISTRY
# ============================================

@server.tool("register-model", "Register a model")
async def register_model(
    name: str,
    version: str,
    type: str,
    path: str,
    config: Optional[Dict[str, Any]] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Register a new model."""
    model_id = f"model-{uuid.uuid4().hex[:8]}"
    model = Model(
        id=model_id,
        name=name,
        version=version,
        type=ModelType(type),
        path=path,
        config=config or {},
        metadata=metadata or {},
    )
    models[model_id] = model
    return model.__dict__


@server.tool("load-model", "Load a model into memory")
async def load_model(model_id: str) -> Dict[str, Any]:
    """Load a model for inference."""
    model = models.get(model_id)
    if not model:
        return {"error": "Model not found", "model_id": model_id}

    if model.status == ModelStatus.READY:
        return {"success": True, "message": "Model already loaded", "model": model.__dict__}

    model.status = ModelStatus.LOADING
    # Simulate loading
    await asyncio.sleep(0.5)
    model.status = ModelStatus.READY
    model.loaded_at = datetime.utcnow().isoformat()
    model.updated_at = datetime.utcnow().isoformat()

    return {"success": True, "model": model.__dict__}


@server.tool("unload-model", "Unload a model from memory")
async def unload_model(model_id: str) -> Dict[str, Any]:
    """Unload a model to free memory."""
    model = models.get(model_id)
    if not model:
        return {"error": "Model not found", "model_id": model_id}

    model.status = ModelStatus.UNLOADED
    model.loaded_at = None
    model.updated_at = datetime.utcnow().isoformat()

    return {"success": True, "model": model.__dict__}


@server.tool("list-models", "List models")
async def list_models(status: Optional[str] = None) -> Dict[str, Any]:
    """List registered models."""
    result = list(models.values())
    if status:
        result = [m for m in result if m.status.value == status]
    return {"models": [m.__dict__ for m in result], "count": len(result)}


@server.tool("get-model", "Get model details")
async def get_model(model_id: str) -> Dict[str, Any]:
    """Get model details."""
    model = models.get(model_id)
    if not model:
        return {"error": "Model not found", "model_id": model_id}
    return model.__dict__


# ============================================
# TOOLS - INFERENCE
# ============================================

@server.tool("predict", "Run inference")
async def predict(
    model_id: str,
    inputs: Any,
    parameters: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Run single inference."""
    model = models.get(model_id)
    if not model:
        return {"error": "Model not found", "model_id": model_id}

    if model.status != ModelStatus.READY:
        return {"error": f"Model not ready: {model.status.value}"}

    model.request_count += 1
    predictions = await run_inference_mock(model, inputs)

    return {
        "model_id": model_id,
        "predictions": predictions,
        "latency_ms": 10,
    }


@server.tool("batch-predict", "Run batch inference")
async def batch_predict(
    model_id: str,
    inputs_batch: List[Any],
    parameters: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Run batch inference."""
    model = models.get(model_id)
    if not model:
        return {"error": "Model not found", "model_id": model_id}

    if model.status != ModelStatus.READY:
        return {"error": f"Model not ready: {model.status.value}"}

    model.request_count += len(inputs_batch)
    predictions = await run_inference_mock(model, inputs_batch)

    return {
        "model_id": model_id,
        "predictions": predictions,
        "batch_size": len(inputs_batch),
        "latency_ms": 50,
    }


# ============================================
# TOOLS - EXPERIMENTS
# ============================================

@server.tool("create-experiment", "Create an experiment")
async def create_experiment(
    name: str,
    description: str = "",
    tags: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """Create a new experiment."""
    exp_id = f"exp-{uuid.uuid4().hex[:8]}"
    exp = Experiment(
        id=exp_id,
        name=name,
        description=description,
        tags=tags or {},
    )
    experiments[exp_id] = exp
    return exp.__dict__


@server.tool("list-experiments", "List experiments")
async def list_experiments() -> Dict[str, Any]:
    """List all experiments."""
    return {"experiments": [e.__dict__ for e in experiments.values()], "count": len(experiments)}


@server.tool("start-run", "Start a training run")
async def start_run(
    experiment_id: str,
    run_name: Optional[str] = None,
    params: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Start a new training run."""
    exp = experiments.get(experiment_id)
    if not exp:
        return {"error": "Experiment not found", "experiment_id": experiment_id}

    run_id = f"run-{uuid.uuid4().hex[:8]}"
    run = Run(
        id=run_id,
        experiment_id=experiment_id,
        name=run_name or f"run-{run_id[-8:]}",
        params=params or {},
    )
    runs[run_id] = run
    return run.__dict__


@server.tool("log-metric", "Log a metric")
async def log_metric(
    run_id: str,
    key: str,
    value: float,
    step: Optional[int] = None,
) -> Dict[str, Any]:
    """Log a metric for a run."""
    run = runs.get(run_id)
    if not run:
        return {"error": "Run not found", "run_id": run_id}

    if key not in run.metrics:
        run.metrics[key] = []

    run.metrics[key].append({
        "value": value,
        "step": step,
        "timestamp": datetime.utcnow().isoformat(),
    })

    return {"success": True}


@server.tool("end-run", "End a training run")
async def end_run(run_id: str, status: str = "completed") -> Dict[str, Any]:
    """End a training run."""
    run = runs.get(run_id)
    if not run:
        return {"error": "Run not found", "run_id": run_id}

    run.status = RunStatus(status)
    run.ended_at = datetime.utcnow().isoformat()
    return run.__dict__


@server.tool("get-run", "Get run details")
async def get_run(run_id: str) -> Dict[str, Any]:
    """Get run details."""
    run = runs.get(run_id)
    if not run:
        return {"error": "Run not found", "run_id": run_id}
    return run.__dict__


@server.tool("list-runs", "List runs")
async def list_runs(experiment_id: Optional[str] = None) -> Dict[str, Any]:
    """List runs."""
    result = list(runs.values())
    if experiment_id:
        result = [r for r in result if r.experiment_id == experiment_id]
    return {"runs": [r.__dict__ for r in result], "count": len(result)}


# ============================================
# RESOURCES
# ============================================

@server.resource("model://{model_id}", "Model")
async def model_resource(model_id: str) -> Dict[str, Any]:
    """Model resource."""
    model = models.get(model_id)
    if not model:
        raise ValueError(f"Model not found: {model_id}")
    return model.__dict__


@server.resource("experiment://{experiment_id}", "Experiment")
async def experiment_resource(experiment_id: str) -> Dict[str, Any]:
    """Experiment resource."""
    exp = experiments.get(experiment_id)
    if not exp:
        raise ValueError(f"Experiment not found: {experiment_id}")
    exp_runs = [r for r in runs.values() if r.experiment_id == exp.id]
    return {"experiment": exp.__dict__, "runs": [r.__dict__ for r in exp_runs]}


@server.resource("run://{run_id}", "Run")
async def run_resource(run_id: str) -> Dict[str, Any]:
    """Run resource."""
    run = runs.get(run_id)
    if not run:
        raise ValueError(f"Run not found: {run_id}")
    return run.__dict__


# ============================================
# PROMPTS
# ============================================

@server.prompt("select-model", "Select model for task")
async def select_model_prompt(task: str, requirements: str = "") -> Dict[str, Any]:
    """Select model prompt."""
    available = [m for m in models.values() if m.status == ModelStatus.READY]

    prompt = f"""Recommend the best model for this task:

Task: {task}
Requirements: {requirements or "None specified"}

Available Models:
{chr(10).join(f"- {m.name} ({m.type.value}) v{m.version} - {m.config.get('task', 'N/A')}" for m in available)}

Provide: model recommendation with pros/cons, expected performance, and any constraints."""

    return {
        "messages": [
            {"role": "system", "content": "You are an ML engineer. Recommend models based on task requirements and available options."},
            {"role": "user", "content": prompt},
        ]
    }


@server.prompt("design-experiment", "Design ML experiment")
async def design_experiment_prompt(
    problem: str,
    data_description: str,
    constraints: str = "",
) -> Dict[str, Any]:
    """Design experiment prompt."""
    prompt = f"""Design an ML experiment:

Problem: {problem}
Data: {data_description}
Constraints: {constraints or "None"}

Provide:
1. Hypothesis
2. Methodology
3. Success metrics
4. Baseline models
5. Experimental setup (train/val/test split, CV strategy)
6. Hyperparameter search space
7. Timeline and resources needed"""

    return {
        "messages": [
            {"role": "system", "content": "You are an ML researcher. Design rigorous, reproducible experiments."},
            {"role": "user", "content": prompt},
        ]
    }


# ============================================
# HEALTH CHECK
# ============================================

@server.tool("health", "Health check")
async def health() -> Dict[str, Any]:
    """Health check endpoint."""
    ready_models = sum(1 for m in models.values() if m.status == ModelStatus.READY)
    active_runs = sum(1 for r in runs.values() if r.status == RunStatus.RUNNING)

    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "models": {"total": len(models), "ready": ready_models},
        "experiments": len(experiments),
        "runs": {"total": len(runs), "active": active_runs},
    }


# ============================================
# MAIN
# ============================================

async def main():
    transport = os.getenv("MCP_TRANSPORT", "websocket")
    port = int(os.getenv("MCP_PORT", "3000"))
    host = os.getenv("MCP_HOST", "0.0.0.0")

    print(f"Starting ml-model-server on {transport}...", file=sys.stderr)

    if transport == "websocket":
        await server.start(transport="websocket", port=port, host=host)
    elif transport == "http-sse":
        await server.start(transport="http-sse", port=port, host=host)
    elif transport == "grpc":
        await server.start(transport="grpc", port=port, host=host)
    else:
        await server.start(transport="stdio")

    print("ML model server started", file=sys.stderr)


if __name__ == "__main__":
    import sys
    asyncio.run(main())
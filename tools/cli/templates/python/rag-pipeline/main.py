#!/usr/bin/env python3
"""
RAG Pipeline MCP Server
Retrieval, reranking, generation, and evaluation
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

class VectorStoreType(str, Enum):
    CHROMA = "chroma"
    FAISS = "faiss"
    PINECONE = "pinecone"
    WEAVIATE = "weaviate"
    QDRANT = "qdrant"
    MEMORY = "memory"


class EmbeddingModel(str, Enum):
    OPENAI_ADA = "openai-ada"
    OPENAI_3_SMALL = "openai-3-small"
    OPENAI_3_LARGE = "openai-3-large"
    SENTENCE_TRANSFORMERS = "sentence-transformers"
    CUSTOM = "custom"


@dataclass
class Index:
    id: str
    name: str
    vector_store: VectorStoreType
    embedding_model: EmbeddingModel
    config: Dict[str, Any] = field(default_factory=dict)
    document_count: int = 0
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())


@dataclass
class Document:
    id: str
    content: str
    metadata: Dict[str, Any] = field(default_factory=dict)
    embedding: Optional[List[float]] = None


# ============================================
# IN-MEMORY STORES
# ============================================

indexes: Dict[str, Index] = {}
documents: Dict[str, List[Document]] = {}


def initialize_sample_data():
    """Initialize sample RAG data."""
    idx = Index(
        id="idx-001",
        name="company-docs",
        vector_store=VectorStoreType.MEMORY,
        embedding_model=EmbeddingModel.SENTENCE_TRANSFORMERS,
        document_count=4,
    )
    indexes[idx.id] = idx

    documents[idx.id] = [
        Document(id="doc-1", content="Our company was founded in 2020 with a mission to build AI tools.", metadata={"source": "about.md"}),
        Document(id="doc-2", content="We offer three main products: MCP Server, MCP Client, and MCP Registry.", metadata={"source": "products.md"}),
        Document(id="doc-3", content="MCP Server supports tools, resources, and prompts capabilities.", metadata={"source": "products.md"}),
        Document(id="doc-4", content="Our pricing starts at $0 for development and scales with usage.", metadata={"source": "pricing.md"}),
    ]


initialize_sample_data()


# ============================================
# MOCK EMBEDDING & SEARCH
# ============================================

async def get_embedding(text: str) -> List[float]:
    """Mock embedding generation."""
    import hashlib
    hash_val = int(hashlib.md5(text.encode()).hexdigest()[:8], 16)
    return [(hash_val + i) % 1000 / 1000.0 for i in range(384)]


def cosine_similarity(a: List[float], b: List[float]) -> float:
    """Calculate cosine similarity."""
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(y * y for y in b) ** 0.5
    return dot / (norm_a * norm_b) if norm_a and norm_b else 0.0


# ============================================
# MCP SERVER
# ============================================

server = McpServer(
    name="rag-pipeline",
    version="1.0.0",
    capabilities={
        "tools": {"listChanged": True},
        "resources": {"subscribe": True, "listChanged": True},
        "prompts": {"listChanged": True},
        "logging": {},
    },
)


# ============================================
# TOOLS - INDEX MANAGEMENT
# ============================================

@server.tool("create-index", "Create a vector index")
async def create_index(
    name: str,
    vector_store: str,
    embedding_model: str,
    config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Create a new vector index."""
    idx_id = f"idx-{uuid.uuid4().hex[:8]}"
    idx = Index(
        id=idx_id,
        name=name,
        vector_store=VectorStoreType(vector_store),
        embedding_model=EmbeddingModel(embedding_model),
        config=config or {},
    )
    indexes[idx_id] = idx
    documents[idx_id] = []
    return idx.__dict__


@server.tool("list-indexes", "List indexes")
async def list_indexes() -> Dict[str, Any]:
    """List all indexes."""
    return {"indexes": [idx.__dict__ for idx in indexes.values()], "count": len(indexes)}


@server.tool("get-index", "Get index details")
async def get_index(index_id: str) -> Dict[str, Any]:
    """Get index details."""
    idx = indexes.get(index_id)
    if not idx:
        return {"error": "Index not found", "index_id": index_id}
    return idx.__dict__


@server.tool("delete-index", "Delete an index")
async def delete_index(index_id: str) -> Dict[str, Any]:
    """Delete an index and its documents."""
    if index_id not in indexes:
        return {"error": "Index not found", "index_id": index_id}

    del indexes[index_id]
    if index_id in documents:
        del documents[index_id]
    return {"success": True, "deleted": index_id}


# ============================================
# TOOLS - DOCUMENT MANAGEMENT
# ============================================

@server.tool("add-documents", "Add documents to index")
async def add_documents(
    index_id: str,
    documents_list: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Add documents to an index."""
    idx = indexes.get(index_id)
    if not idx:
        return {"error": "Index not found", "index_id": index_id}

    index_docs = documents.get(index_id, [])
    added = 0

    for doc_data in documents_list:
        doc_id = doc_data.get("id", f"doc-{uuid.uuid4().hex[:8]}")
        content = doc_data["content"]
        metadata = doc_data.get("metadata", {})
        embedding = doc_data.get("embedding")

        if not embedding:
            embedding = await get_embedding(content)

        doc = Document(id=doc_id, content=content, metadata=metadata, embedding=embedding)
        index_docs.append(doc)
        added += 1

    documents[index_id] = index_docs
    idx.document_count = len(index_docs)

    return {"added": added, "total": idx.document_count}


@server.tool("delete-documents", "Delete documents from index")
async def delete_documents(index_id: str, document_ids: List[str]) -> Dict[str, Any]:
    """Delete documents from index."""
    idx = indexes.get(index_id)
    if not idx:
        return {"error": "Index not found", "index_id": index_id}

    index_docs = documents.get(index_id, [])
    original_count = len(index_docs)
    index_docs = [d for d in index_docs if d.id not in document_ids]
    documents[index_id] = index_docs
    idx.document_count = len(index_docs)

    return {"deleted": original_count - len(index_docs), "remaining": len(index_docs)}


# ============================================
# TOOLS - SEARCH & RETRIEVAL
# ============================================

@server.tool("search", "Search documents")
async def search(
    index_id: str,
    query: str,
    top_k: int = 10,
    filter: Optional[Dict[str, Any]] = None,
    rerank: bool = False,
) -> Dict[str, Any]:
    """Search documents in index."""
    idx = indexes.get(index_id)
    if not idx:
        return {"error": "Index not found", "index_id": index_id}

    query_embedding = await get_embedding(query)
    index_docs = documents.get(index_id, [])

    # Filter
    if filter:
        index_docs = [
            d for d in index_docs
            if all(d.metadata.get(k) == v for k, v in filter.items())
        ]

    # Score
    results = [
        {"document": d, "score": cosine_similarity(query_embedding, d.embedding or [])}
        for d in index_docs
    ]
    results.sort(key=lambda x: x["score"], reverse=True)
    results = results[:top_k]

    # Rerank
    if rerank:
        results = [
            {**r, "rerank_score": r["score"] * 0.9 + 0.1 - i * 0.01}
            for i, r in enumerate(results)
        ]
        results.sort(key=lambda x: x.get("rerank_score", 0), reverse=True)

    return {
        "query": query,
        "results": [
            {
                "id": r["document"].id,
                "content": r["document"].content,
                "metadata": r["document"].metadata,
                "score": r["score"],
                "rerank_score": r.get("rerank_score"),
            }
            for r in results
        ],
    }


@server.tool("rerank", "Rerank documents")
async def rerank(
    query: str,
    documents_list: List[Dict[str, Any]],
    top_k: int = 5,
) -> Dict[str, Any]:
    """Rerank a list of documents."""
    query_embedding = await get_embedding(query)

    reranked = []
    for doc in documents_list:
        embedding = doc.get("embedding")
        score = cosine_similarity(query_embedding, embedding) if embedding else 0.5
        reranked.append({**doc, "rerank_score": score})

    reranked.sort(key=lambda x: x["rerank_score"], reverse=True)
    reranked = reranked[:top_k]

    return {"query": query, "results": reranked}


# ============================================
# TOOLS - GENERATION
# ============================================

@server.tool("generate", "Generate answer from context")
async def generate(
    query: str,
    context_documents: List[Dict[str, Any]],
    system_prompt: Optional[str] = None,
    temperature: float = 0.7,
    max_tokens: int = 512,
) -> Dict[str, Any]:
    """Generate answer using retrieved context."""
    context = "\n\n".join(f"[{i+1}] {d['content']}" for i, d in enumerate(context_documents))
    system = system_prompt or "Answer based on context. Cite sources."

    # Mock generation
    answer = f"Based on the context: {context[:200]}..."

    return {
        "query": query,
        "answer": answer,
        "context_used": len(context_documents),
        "citations": [d["id"] for d in context_documents],
    }


# ============================================
# RESOURCES
# ============================================

@server.resource("index://{index_id}", "Index")
async def index_resource(index_id: str) -> Dict[str, Any]:
    """Index resource."""
    idx = indexes.get(index_id)
    if not idx:
        raise ValueError(f"Index not found: {index_id}")
    return idx.__dict__


@server.resource("index://{index_id}/documents", "Documents")
async def index_documents_resource(index_id: str) -> Dict[str, Any]:
    """Documents in index."""
    docs = documents.get(index_id, [])
    return {"documents": [d.__dict__ for d in docs], "count": len(docs)}


@server.resource("document://{index_id}/{document_id}", "Document")
async def document_resource(index_id: str, document_id: str) -> Dict[str, Any]:
    """Document resource."""
    docs = documents.get(index_id, [])
    doc = next((d for d in docs if d.id == document_id), None)
    if not doc:
        raise ValueError(f"Document not found: {document_id}")
    return doc.__dict__


# ============================================
# PROMPTS
# ============================================

@server.prompt("rag-query", "RAG query prompt")
async def rag_query_prompt(query: str, index_id: str, top_k: int = 5) -> Dict[str, Any]:
    """RAG query prompt."""
    prompt = f"""Question: {query}
I'll retrieve from index {index_id}. Answer based on retrieved info."""

    return {
        "messages": [
            {"role": "system", "content": "You are a RAG assistant. Answer using retrieved context. Cite sources."},
            {"role": "user", "content": prompt},
        ]
    }


@server.prompt("evaluate-rag", "Evaluate RAG quality")
async def evaluate_rag_prompt(query: str, expected_answer: str, index_id: str) -> Dict[str, Any]:
    """Evaluate RAG prompt."""
    prompt = f"""Query: {query}
Expected: {expected_answer}
Index: {index_id}
Evaluate retrieval and generation."""

    return {
        "messages": [
            {"role": "system", "content": "Evaluation expert. Assess RAG quality."},
            {"role": "user", "content": prompt},
        ]
    }


# ============================================
# HEALTH CHECK
# ============================================

@server.tool("health", "Health check")
async def health() -> Dict[str, Any]:
    """Health check endpoint."""
    total_docs = sum(len(docs) for docs in documents.values())
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "indexes": len(indexes),
        "total_documents": total_docs,
    }


# ============================================
# MAIN
# ============================================

async def main():
    transport = os.getenv("MCP_TRANSPORT", "websocket")
    port = int(os.getenv("MCP_PORT", "3000"))
    host = os.getenv("MCP_HOST", "0.0.0.0")

    print(f"Starting rag-pipeline on {transport}...", file=sys.stderr)

    if transport == "websocket":
        await server.start(transport="websocket", port=port, host=host)
    elif transport == "http-sse":
        await server.start(transport="http-sse", port=port, host=host)
    elif transport == "grpc":
        await server.start(transport="grpc", port=port, host=host)
    else:
        await server.start(transport="stdio")

    print("RAG pipeline server started", file=sys.stderr)


if __name__ == "__main__":
    import sys
    asyncio.run(main())
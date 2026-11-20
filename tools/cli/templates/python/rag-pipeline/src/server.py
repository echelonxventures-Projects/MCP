"""
RAG Pipeline MCP Server
Retrieval, reranking, and generation tools
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
    name="rag-pipeline",
    version="1.0.0",
    capabilities={
        "tools": {"listChanged": True},
        "resources": {"subscribe": True, "listChanged": True},
        "prompts": {"listChanged": True},
        "logging": {},
    }
)


# Pydantic models
class VectorStoreType(str, Enum):
    CHROMA = "chroma"
    FAISS = "faiss"
    PINECONE = "pinecone"
    WEAVIATE = "weaviate"
    QDRANT = "qdrant"


class EmbeddingModel(str, Enum):
    OPENAI_ADA = "text-embedding-ada-002"
    OPENAI_3_SMALL = "text-embedding-3-small"
    OPENAI_3_LARGE = "text-embedding-3-large"
    SENTENCE_TRANSFORMERS = "sentence-transformers/all-MiniLM-L6-v2"
    CUSTOM = "custom"


class IndexConfig(BaseModel):
    name: str = Field(description="Index name")
    vector_store: VectorStoreType = Field(description="Vector store type")
    embedding_model: EmbeddingModel = Field(description="Embedding model")
    config: Dict[str, Any] = Field(description="Vector store configuration")
    metadata: Optional[Dict[str, Any]] = Field(default=None, description="Additional metadata")


class Document(BaseModel):
    id: str = Field(description="Document ID")
    content: str = Field(description="Document content")
    metadata: Optional[Dict[str, Any]] = Field(default=None, description="Document metadata")
    embedding: Optional[List[float]] = Field(default=None, description="Pre-computed embedding")


class AddDocumentsParams(BaseModel):
    index_id: str = Field(description="Index ID")
    documents: List[Document] = Field(description="Documents to add")


class SearchParams(BaseModel):
    index_id: str = Field(description="Index ID")
    query: str = Field(description="Search query")
    top_k: int = Field(default=10, description="Number of results", ge=1, le=100)
    filter: Optional[Dict[str, Any]] = Field(default=None, description="Metadata filter")
    rerank: bool = Field(default=False, description="Whether to rerank results")


class RerankParams(BaseModel):
    query: str = Field(description="Original query")
    documents: List[Document] = Field(description="Documents to rerank")
    top_k: int = Field(default=5, description="Number of results after reranking", ge=1, le=50)


class GenerateParams(BaseModel):
    query: str = Field(description="User query")
    context_documents: List[Document] = Field(description="Retrieved context documents")
    system_prompt: Optional[str] = Field(default=None, description="Custom system prompt")
    temperature: float = Field(default=0.7, description="Generation temperature", ge=0.0, le=2.0)
    max_tokens: int = Field(default=512, description="Max tokens to generate", ge=1, le=4096)


# In-memory stores
indexes: Dict[str, Dict[str, Any]] = {}
documents_store: Dict[str, List[Document]] = {}


# Initialize sample data
def initialize_sample_data():
    # Sample index
    idx_id = f"idx-{uuid.uuid4().hex[:8]}"
    indexes[idx_id] = {
        "id": idx_id,
        "name": "company-docs",
        "vector_store": VectorStoreType.CHROMA,
        "embedding_model": EmbeddingModel.SENTENCE_TRANSFORMERS,
        "config": {"persist_directory": "./chroma_db"},
        "document_count": 0,
        "created_at": datetime.utcnow().isoformat(),
    }
    documents_store[idx_id] = [
        Document(id="doc-1", content="Our company was founded in 2020 with a mission to build AI tools.", metadata={"source": "about.md", "section": "history"}),
        Document(id="doc-2", content="We offer three main products: MCP Server, MCP Client, and MCP Registry.", metadata={"source": "products.md", "section": "overview"}),
        Document(id="doc-3", content="MCP Server supports tools, resources, and prompts capabilities.", metadata={"source": "products.md", "section": "server"}),
        Document(id="doc-4", content="Our pricing starts at $0 for development and scales with usage.", metadata={"source": "pricing.md", "section": "tiers"}),
    ]
    indexes[idx_id]["document_count"] = len(documents_store[idx_id])


initialize_sample_data()


# Mock embedding function
async def get_embedding(text: str, model: EmbeddingModel) -> List[float]:
    # In real implementation, call actual embedding model
    import hashlib
    hash_val = int(hashlib.md5(text.encode()).hexdigest(), 16)
    # Generate pseudo-random vector
    return [(hash_val >> i & 0xFF) / 255.0 for i in range(0, 384, 8)][:384]


# Mock search function
def search_index(index_id: str, query_embedding: List[float], top_k: int, filter_: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    docs = documents_store.get(index_id, [])
    results = []
    for doc in docs:
        if filter_:
            match = True
            for k, v in filter_.items():
                if doc.metadata.get(k) != v:
                    match = False
                    break
            if not match:
                continue

        # Mock similarity score
        score = 0.9 - (hash(doc.id) % 100) / 1000.0
        results.append({"document": doc, "score": score})

    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:top_k]


# ============================================
# TOOLS
# ============================================

@server.tool("create-index", "Create a new vector index")
async def create_index(params: IndexConfig) -> dict:
    idx_id = f"idx-{uuid.uuid4().hex[:8]}"
    index = {
        "id": idx_id,
        **params.model_dump(),
        "document_count": 0,
        "created_at": datetime.utcnow().isoformat(),
    }
    indexes[idx_id] = index
    documents_store[idx_id] = []
    return {"content": [{"type": "text", "text": json.dumps(index, indent=2)}]}


@server.tool("list-indexes", "List all vector indexes")
async def list_indexes() -> dict:
    return {
        "content": [{
            "type": "text",
            "text": json.dumps({"indexes": list(indexes.values())}, indent=2),
        }],
    }


@server.tool("get-index", "Get index details")
async def get_index(index_id: str = Field(description="Index ID")) -> dict:
    if index_id not in indexes:
        return {"content": [{"type": "text", "text": json.dumps({"error": "Index not found"})}], "isError": True}
    return {"content": [{"type": "text", "text": json.dumps(indexes[index_id], indent=2)}]}


@server.tool("add-documents", "Add documents to an index")
async def add_documents(params: AddDocumentsParams) -> dict:
    if params.index_id not in indexes:
        return {"content": [{"type": "text", "text": json.dumps({"error": "Index not found"})}], "isError": True}

    index = indexes[params.index_id]
    added = 0

    for doc in params.documents:
        # Generate embedding if not provided
        if doc.embedding is None:
            doc.embedding = await get_embedding(doc.content, EmbeddingModel(index["embedding_model"]))

        documents_store[params.index_id].append(doc)
        added += 1

    index["document_count"] = len(documents_store[params.index_id])

    return {"content": [{"type": "text", "text": json.dumps({"added": added, "total": index["document_count"]}, indent=2)}]}


@server.tool("search", "Search for similar documents")
async def search(params: SearchParams) -> dict:
    if params.index_id not in indexes:
        return {"content": [{"type": "text", "text": json.dumps({"error": "Index not found"})}], "isError": True}

    index = indexes[params.index_id]
    query_embedding = await get_embedding(params.query, EmbeddingModel(index["embedding_model"]))

    results = search_index(params.index_id, query_embedding, params.top_k, params.filter)

    # If rerank requested, apply reranking
    if params.rerank and results:
        # Mock reranking - just re-score
        for r in results:
            r["rerank_score"] = r["score"] * 0.9 + 0.1
        results.sort(key=lambda x: x["rerank_score"], reverse=True)

    return {
        "content": [{
            "type": "text",
            "text": json.dumps({
                "query": params.query,
                "results": [
                    {
                        "id": r["document"].id,
                        "content": r["document"].content,
                        "metadata": r["document"].metadata,
                        "score": r["score"],
                        **({"rerank_score": r["rerank_score"]} if "rerank_score" in r else {}),
                    }
                    for r in results
                ],
            }, indent=2),
        }],
    }


@server.tool("rerank", "Rerank documents for a query")
async def rerank(params: RerankParams) -> dict:
    # Mock reranking
    reranked = []
    for i, doc in enumerate(params.documents):
        score = 0.95 - (i * 0.05)
        reranked.append({
            "document": doc,
            "rerank_score": score,
        })

    reranked.sort(key=lambda x: x["rerank_score"], reverse=True)

    return {
        "content": [{
            "type": "text",
            "text": json.dumps({
                "query": params.query,
                "results": [
                    {
                        "id": r["document"].id,
                        "content": r["document"].content,
                        "metadata": r["document"].metadata,
                        "rerank_score": r["rerank_score"],
                    }
                    for r in reranked[:params.top_k]
                ],
            }, indent=2),
        }],
    }


@server.tool("generate", "Generate answer using retrieved context")
async def generate(params: GenerateParams) -> dict:
    # Mock generation
    context = "\n\n".join([f"[{i+1}] {doc.content}" for i, doc in enumerate(params.context_documents)])

    system = params.system_prompt or "You are a helpful assistant. Answer the question based on the provided context."

    # In real implementation, call LLM
    answer = f"Based on the provided context, here's what I found: {context[:200]}..."

    return {
        "content": [{
            "type": "text",
            "text": json.dumps({
                "query": params.query,
                "answer": answer,
                "context_used": len(params.context_documents),
                "citations": [doc.id for doc in params.context_documents],
            }, indent=2),
        }],
    }


@server.tool("delete-documents", "Delete documents from an index")
async def delete_documents(
    index_id: str = Field(description="Index ID"),
    document_ids: List[str] = Field(description="Document IDs to delete"),
) -> dict:
    if index_id not in indexes:
        return {"content": [{"type": "text", "text": json.dumps({"error": "Index not found"})}], "isError": True}

    docs = documents_store[index_id]
    original_count = len(docs)
    documents_store[index_id] = [d for d in docs if d.id not in document_ids]
    deleted = original_count - len(documents_store[index_id])

    indexes[index_id]["document_count"] = len(documents_store[index_id])

    return {"content": [{"type": "text", "text": json.dumps({"deleted": deleted, "remaining": indexes[index_id]["document_count"]}, indent=2)}]}


# ============================================
# RESOURCES
# ============================================

@server.resource("index://{index_id}", "Index information")
async def index_resource(uri) -> dict:
    idx_id = uri.params["index_id"]
    if idx_id not in indexes:
        raise ValueError(f"Index not found: {idx_id}")

    return {
        "contents": [{
            "uri": str(uri),
            "mimeType": "application/json",
            "text": json.dumps(indexes[idx_id], indent=2),
        }],
    }


@server.resource("index://{index_id}/documents", "All documents in an index")
async def index_documents_resource(uri) -> dict:
    idx_id = uri.params["index_id"]
    if idx_id not in indexes:
        raise ValueError(f"Index not found: {idx_id}")

    docs = documents_store.get(idx_id, [])
    return {
        "contents": [{
            "uri": str(uri),
            "mimeType": "application/json",
            "text": json.dumps({
                "index_id": idx_id,
                "documents": [d.model_dump() for d in docs],
                "count": len(docs),
            }, indent=2),
        }],
    }


@server.resource("document://{index_id}/{document_id}", "Single document")
async def document_resource(uri) -> dict:
    idx_id = uri.params["index_id"]
    doc_id = uri.params["document_id"]

    if idx_id not in indexes:
        raise ValueError(f"Index not found: {idx_id}")

    docs = documents_store.get(idx_id, [])
    doc = next((d for d in docs if d.id == doc_id), None)
    if not doc:
        raise ValueError(f"Document not found: {doc_id}")

    return {
        "contents": [{
            "uri": str(uri),
            "mimeType": "application/json",
            "text": json.dumps(doc.model_dump(), indent=2),
        }],
    }


# ============================================
# PROMPTS
# ============================================

class RagQueryParams(BaseModel):
    query: str = Field(description="User question")
    index_id: str = Field(description="Index to search")
    top_k: int = Field(default=5, description="Number of documents to retrieve")


@server.prompt("rag-query", "Answer a question using RAG")
async def rag_query(params: RagQueryParams) -> dict:
    if params.index_id not in indexes:
        return {
            "messages": [
                {"role": "system", "content": "You are a RAG assistant."},
                {"role": "user", "content": f"Index {params.index_id} not found."},
            ],
        }

    return {
        "messages": [
            {
                "role": "system",
                "content": "You are a helpful assistant that answers questions using retrieved context. Always cite your sources.",
            },
            {
                "role": "user",
                "content": f"Question: {params.query}\n\nI will retrieve relevant documents from index {params.index_id} and provide them as context. Please answer based on the retrieved information.",
            },
        ],
    }


class EvaluateRagParams(BaseModel):
    query: str = Field(description="Test query")
    expected_answer: str = Field(description="Expected answer")
    index_id: str = Field(description="Index to search")


@server.prompt("evaluate-rag", "Evaluate RAG system performance")
async def evaluate_rag(params: EvaluateRagParams) -> dict:
    return {
        "messages": [
            {
                "role": "system",
                "content": "You are an evaluation expert. Assess the quality of a RAG system's response.",
            },
            {
                "role": "user",
                "content": f"Query: {params.query}\nExpected: {params.expected_answer}\nIndex: {params.index_id}\n\nEvaluate the retrieval and generation quality. Provide metrics and suggestions.",
            },
        ],
    }


# ============================================
# HEALTH CHECK
# ============================================

@server.tool("health", "Health check endpoint")
async def health() -> dict:
    total_docs = sum(len(docs) for docs in documents_store.values())
    return {
        "content": [{
            "type": "text",
            "text": json.dumps({
                "status": "healthy",
                "timestamp": datetime.utcnow().isoformat(),
                "indexes": len(indexes),
                "totalDocuments": total_docs,
            }, indent=2),
        }],
    }


async def main():
    transport = os.getenv("MCP_TRANSPORT", "stdio")
    port = int(os.getenv("MCP_PORT", "3000"))
    host = os.getenv("MCP_HOST", "0.0.0.0")

    print(f"Starting rag-pipeline on {transport}...", file=__import__("sys").stderr)

    if transport == "websocket":
        await server.start(transport="websocket", port=port, host=host)
    elif transport == "http-sse":
        await server.start(transport="http-sse", port=port, host=host)
    elif transport == "grpc":
        await server.start(transport="grpc", port=port, host=host)
    else:
        await server.start(transport="stdio")

    print("RAG pipeline server started successfully", file=__import__("sys").stderr)


if __name__ == "__main__":
    asyncio.run(main())
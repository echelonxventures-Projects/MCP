/**
 * RAG Pipeline MCP Server
 * Retrieval, reranking, and generation tools
 */

import { McpServer, tool, resource, prompt } from "@mcp/server";
import { z } from "zod";

// Type definitions
type VectorStoreType = "chroma" | "faiss" | "pinecone" | "weaviate" | "qdrant" | "memory";
type EmbeddingModel = "openai-ada" | "openai-3-small" | "openai-3-large" | "sentence-transformers" | "custom";

interface Index {
  id: string;
  name: string;
  vectorStore: VectorStoreType;
  embeddingModel: EmbeddingModel;
  config: Record<string, unknown>;
  documentCount: number;
  createdAt: string;
}

interface Document {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
  embedding?: number[];
}

// In-memory stores
const indexes: Map<string, Index> = new Map();
const documents: Map<string, Document[]> = new Map();

// Initialize sample data
function initializeSampleData() {
  const idx: Index = {
    id: "idx-001",
    name: "company-docs",
    vectorStore: "memory",
    embeddingModel: "sentence-transformers",
    config: {},
    documentCount: 4,
    createdAt: new Date().toISOString(),
  };
  indexes.set(idx.id, idx);

  documents.set(idx.id, [
    { id: "doc-1", content: "Our company was founded in 2020 with a mission to build AI tools.", metadata: { source: "about.md" } },
    { id: "doc-2", content: "We offer three main products: MCP Server, MCP Client, and MCP Registry.", metadata: { source: "products.md" } },
    { id: "doc-3", content: "MCP Server supports tools, resources, and prompts capabilities.", metadata: { source: "products.md" } },
    { id: "doc-4", content: "Our pricing starts at $0 for development and scales with usage.", metadata: { source: "pricing.md" } },
  ]);
}

initializeSampleData();

// Mock embedding function
async function getEmbedding(text: string): Promise<number[]> {
  const hash = Array.from(text).reduce((a, c) => a + c.charCodeAt(0), 0);
  return Array.from({ length: 384 }, (_, i) => Math.sin(hash + i) * 0.5);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Create MCP server
const server = new McpServer({
  name: "rag-pipeline",
  version: "1.0.0",
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

server.tool("create-index", "Create index", {
  name: z.string(), vectorStore: z.enum(["chroma", "faiss", "pinecone", "weaviate", "qdrant", "memory"]),
  embeddingModel: z.enum(["openai-ada", "openai-3-small", "openai-3-large", "sentence-transformers", "custom"]),
  config: z.record(z.unknown())
}, async ({ name, vectorStore, embeddingModel, config }) => {
  const id = `idx-${Date.now()}`;
  const idx: Index = { id, name, vectorStore, embeddingModel, config, documentCount: 0, createdAt: new Date().toISOString() };
  indexes.set(id, idx);
  documents.set(id, []);
  return { content: [{ type: "text", text: JSON.stringify(idx, null, 2) }] });
});

server.tool("list-indexes", "List indexes", {}, async () => ({
  content: [{ type: "text", text: JSON.stringify({ indexes: Array.from(indexes.values()) }, null, 2) }]
}));

server.tool("get-index", "Get index", {
  indexId: z.string()
}, async ({ indexId }) => {
  const idx = indexes.get(indexId);
  if (!idx) return { content: [{ type: "text", text: JSON.stringify({ error: "Not found" }) }], isError: true };
  return { content: [{ type: "text", text: JSON.stringify(idx, null, 2) }] });
});

server.tool("add-documents", "Add documents", {
  indexId: z.string(), documents: z.array(z.object({
    id: z.string(), content: z.string(), metadata: z.record(z.unknown()).optional(), embedding: z.array(z.number()).optional()
  }))
}, async ({ indexId, documents: docs }) => {
  const idx = indexes.get(indexId);
  if (!idx) return { content: [{ type: "text", text: JSON.stringify({ error: "Not found" }) }], isError: true };

  const indexDocs = documents.get(indexId) || [];
  let added = 0;

  for (const doc of docs) {
    if (!doc.embedding) doc.embedding = await getEmbedding(doc.content);
    indexDocs.push(doc);
    added++;
  }

  documents.set(indexId, indexDocs);
  idx.documentCount = indexDocs.length;
  indexes.set(indexId, idx);

  return { content: [{ type: "text", text: JSON.stringify({ added, total: idx.documentCount }, null, 2) }] });
});

server.tool("search", "Search documents", {
  indexId: z.string(), query: z.string(), topK: z.number().default(10),
  filter: z.record(z.unknown()).optional(), rerank: z.boolean().default(false)
}, async ({ indexId, query, topK = 10, filter, rerank = false }) => {
  const idx = indexes.get(indexId);
  if (!idx) return { content: [{ type: "text", text: JSON.stringify({ error: "Not found" }) }], isError: true };

  const queryEmbedding = await getEmbedding(query);
  const indexDocs = documents.get(indexId) || [];

  let results = indexDocs
    .filter(doc => {
      if (!filter) return true;
      return Object.entries(filter).every(([k, v]) => doc.metadata?.[k] === v);
    })
    .map(doc => ({ document: doc, score: cosineSimilarity(queryEmbedding, doc.embedding || []) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  if (rerank) {
    results = results.map((r, i) => ({ ...r, rerankScore: r.score * 0.9 + 0.1 - i * 0.01 }))
      .sort((a, b) => (b.rerankScore || 0) - (a.rerankScore || 0));
  }

  return { content: [{ type: "text", text: JSON.stringify({ query, results: results.map(r => ({ id: r.document.id, content: r.document.content, metadata: r.document.metadata, score: r.score, rerankScore: r.rerankScore })) }, null, 2) }] });
});

server.tool("rerank", "Rerank documents", {
  query: z.string(), documents: z.array(z.object({ id: z.string(), content: z.string(), metadata: z.record(z.unknown()).optional() })),
  topK: z.number().default(5)
}, async ({ query, documents: docs, topK = 5 }) => {
  const queryEmbedding = await getEmbedding(query);
  const reranked = docs
    .map(doc => ({ document: doc, rerankScore: doc.embedding ? cosineSimilarity(queryEmbedding, doc.embedding) : 0.5 }))
    .sort((a, b) => b.rerankScore - a.rerankScore)
    .slice(0, topK);

  return { content: [{ type: "text", text: JSON.stringify({ query, results: reranked.map(r => ({ id: r.document.id, content: r.document.content, metadata: r.document.metadata, rerankScore: r.rerankScore })) }, null, 2) }] });
});

server.tool("generate", "Generate answer", {
  query: z.string(), contextDocuments: z.array(z.object({ id: z.string(), content: z.string(), metadata: z.record(z.unknown()).optional() })),
  systemPrompt: z.string().optional(), temperature: z.number().default(0.7), maxTokens: z.number().default(512)
}, async ({ query, contextDocuments, temperature = 0.7 }) => {
  const context = contextDocuments.map((d, i) => `[${i + 1}] ${d.content}`).join("\n\n");
  const system = systemPrompt || "Answer based on context. Cite sources.";

  // Mock generation
  const answer = `Based on the context: ${context.substring(0, 200)}...`;

  return { content: [{ type: "text", text: JSON.stringify({ query, answer, contextUsed: contextDocuments.length, citations: contextDocuments.map(d => d.id) }, null, 2) }] });
});

server.tool("delete-documents", "Delete documents", {
  indexId: z.string(), documentIds: z.array(z.string())
}, async ({ indexId, documentIds }) => {
  const idx = indexes.get(indexId);
  if (!idx) return { content: [{ type: "text", text: JSON.stringify({ error: "Not found" }) }], isError: true };

  const docs = documents.get(indexId) || [];
  const originalCount = docs.length;
  const filtered = docs.filter(d => !documentIds.includes(d.id));
  documents.set(indexId, filtered);
  idx.documentCount = filtered.length;
  indexes.set(indexId, idx);

  return { content: [{ type: "text", text: JSON.stringify({ deleted: originalCount - filtered.length, remaining: filtered.length }, null, 2) }] });
});

// ============================================
// RESOURCES
// ============================================

server.resource("index://{indexId}", "Index", async (uri) => {
  const idx = indexes.get(uri.params.indexId);
  if (!idx) throw new Error(`Not found: ${uri.params.indexId}`);
  return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(idx, null, 2) }] });
});

server.resource("index://{indexId}/documents", "Documents", async (uri) => {
  const docs = documents.get(uri.params.indexId) || [];
  return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ documents: docs, count: docs.length }, null, 2) }] });
});

server.resource("document://{indexId}/{documentId}", "Document", async (uri) => {
  const docs = documents.get(uri.params.indexId) || [];
  const doc = docs.find(d => d.id === uri.params.documentId);
  if (!doc) throw new Error(`Not found: ${uri.params.documentId}`);
  return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(doc, null, 2) }] });
});

// ============================================
// PROMPTS
// ============================================

server.prompt("rag-query", "RAG query", {
  query: z.string(), indexId: z.string(), topK: z.number().default(5)
}, ({ query, indexId, topK }) => ({
  messages: [
    { role: "system", content: "You are a RAG assistant. Answer using retrieved context. Cite sources." },
    { role: "user", content: `Question: ${query}\nI'll retrieve from index ${indexId}. Answer based on retrieved info.` }
  ]
}));

server.prompt("evaluate-rag", "Evaluate RAG", {
  query: z.string(), expectedAnswer: z.string(), indexId: z.string()
}, ({ query, expectedAnswer, indexId }) => ({
  messages: [
    { role: "system", content: "Evaluation expert. Assess RAG quality." },
    { role: "user", content: `Query: ${query}\nExpected: ${expectedAnswer}\nIndex: ${indexId}\nEvaluate retrieval and generation.` }
  ]
}));

// ============================================
// HEALTH
// ============================================

server.tool("health", "Health check", {}, async () => ({
  content: [{ type: "text", text: JSON.stringify({ status: "healthy", timestamp: new Date().toISOString(), indexes: indexes.size, totalDocuments: Array.from(documents.values()).reduce((a, b) => a + b.length, 0) }, null, 2) }]
}));

// Start server
async function main() {
  const transport = process.env.MCP_TRANSPORT || "websocket";
  const port = parseInt(process.env.MCP_PORT || "3000", 10);
  const host = process.env.MCP_HOST || "0.0.0.0";

  console.error(`Starting rag-pipeline on ${transport}...`);

  if (transport === "websocket") await server.start({ transport: "websocket", port, host });
  else if (transport === "http-sse") await server.start({ transport: "http-sse", port, host });
  else if (transport === "grpc") await server.start({ transport: "grpc", port, host });
  else await server.start({ transport: "stdio" });

  console.error("RAG pipeline server started");
}

main().catch((e) => { console.error("Failed:", e); process.exit(1); });
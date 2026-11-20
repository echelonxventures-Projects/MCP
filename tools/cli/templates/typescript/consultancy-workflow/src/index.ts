/**
 * Consultancy Workflow MCP Server
 * Document analysis, template generation, report creation, and workflow automation
 */

import { McpServer, tool, resource, prompt } from "@mcp/server";
import { z } from "zod";

// Type definitions
type DocumentType = "contract" | "proposal" | "report" | "memo" | "specification" | "policy" | "meeting_notes" | "email";
type WorkflowStatus = "draft" | "in_review" | "approved" | "rejected" | "published" | "archived";
type TaskStatus = "todo" | "in_progress" | "blocked" | "done";

interface Document {
  id: string;
  title: string;
  type: DocumentType;
  content: string;
  version: number;
  status: WorkflowStatus;
  author: string;
  reviewers: string[];
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface Template {
  id: string;
  name: string;
  description: string;
  type: DocumentType;
  content: string;
  variables: Array<{
    name: string;
    type: string;
    description: string;
    required: boolean;
    default?: unknown;
    options?: string[];
  }>;
  tags: string[];
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface Workflow {
  id: string;
  name: string;
  description: string;
  documentId: string;
  currentStep: number;
  steps: Array<{
    name: string;
    assignee: string;
    action: string;
    status: string;
    startedAt?: string;
    completedAt?: string;
    actionTaken?: string;
    comment?: string;
  }>;
  status: WorkflowStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface Task {
  id: string;
  title: string;
  description: string;
  workflowId?: string;
  documentId?: string;
  assignee: string;
  status: TaskStatus;
  priority: number;
  dueDate?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface AnalysisResult {
  documentId: string;
  summary: string;
  keyPoints: string[];
  entities: Array<{ type: string; value: string; confidence: number }>;
  sentiment: string;
  riskFactors: string[];
  recommendations: string[];
  wordCount: number;
  readingTimeMin: number;
  analyzedAt: string;
}

// In-memory stores
const documents: Map<string, Document> = new Map();
const templates: Map<string, Template> = new Map();
const workflows: Map<string, Workflow> = new Map();
const tasks: Map<string, Task> = new Map();
const analysisCache: Map<string, AnalysisResult> = new Map();

// Initialize sample data
function initializeSampleData() {
  const t1: Template = {
    id: "tpl-001",
    name: "Consulting Proposal",
    description: "Standard consulting proposal template",
    type: "proposal",
    content: `# {{project_name}} Consulting Proposal

**Prepared for:** {{client_name}}
**Date:** {{date}}
**Prepared by:** {{consultant_name}}

## Executive Summary
{{executive_summary}}

## Scope of Work
{{scope_of_work}}

## Timeline
{{timeline}}

## Investment
{{investment}}

## Terms & Conditions
{{terms}}`,
    variables: [
      { name: "project_name", type: "string", description: "Project name", required: true },
      { name: "client_name", type: "string", description: "Client name", required: true },
      { name: "date", type: "date", description: "Proposal date", required: true, default: new Date().toISOString().split('T')[0] },
      { name: "consultant_name", type: "string", description: "Consultant name", required: true },
      { name: "executive_summary", type: "text", description: "Executive summary", required: true },
      { name: "scope_of_work", type: "text", description: "Scope of work", required: true },
      { name: "timeline", type: "text", description: "Project timeline", required: true },
      { name: "investment", type: "text", description: "Investment details", required: true },
      { name: "terms", type: "text", description: "Terms and conditions", required: false, default: "Standard terms apply." },
    ],
    tags: ["proposal", "consulting", "standard"],
    isActive: true,
    createdBy: "system",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const t2: Template = {
    id: "tpl-002",
    name: "Project Status Report",
    description: "Weekly project status report",
    type: "report",
    content: `# {{project_name}} - Status Report

**Period:** {{period_start}} to {{period_end}}
**Report Date:** {{report_date}}
**Project Manager:** {{pm_name}}

## Overall Status
{{overall_status}}

## Key Accomplishments
{{accomplishments}}

## Upcoming Priorities
{{priorities}}

## Risks & Issues
{{risks}}

## Budget Status
{{budget_status}}

## Next Steps
{{next_steps}}`,
    variables: [
      { name: "project_name", type: "string", description: "Project name", required: true },
      { name: "period_start", type: "date", description: "Period start date", required: true },
      { name: "period_end", type: "date", description: "Period end date", required: true },
      { name: "report_date", type: "date", description: "Report date", required: true, default: new Date().toISOString().split('T')[0] },
      { name: "pm_name", type: "string", description: "Project manager name", required: true },
      { name: "overall_status", type: "choice", description: "Overall status", required: true, options: ["On Track", "At Risk", "Off Track"] },
      { name: "accomplishments", type: "text", description: "Key accomplishments", required: true },
      { name: "priorities", type: "text", description: "Upcoming priorities", required: true },
      { name: "risks", type: "text", description: "Risks and issues", required: false, default: "None identified." },
      { name: "budget_status", type: "text", description: "Budget status", required: true },
      { name: "next_steps", type: "text", description: "Next steps", required: true },
    ],
    tags: ["report", "status", "weekly"],
    isActive: true,
    createdBy: "system",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  templates.set(t1.id, t1);
  templates.set(t2.id, t2);

  const d1: Document = {
    id: "doc-001",
    title: "Q4 Strategic Plan",
    type: "report",
    content: `# Q4 Strategic Plan

## Overview
This document outlines the strategic initiatives for Q4 2024.

## Objectives
1. Increase revenue by 20%
2. Launch new product line
3. Expand to two new markets
4. Improve customer satisfaction to 4.8/5

## Key Initiatives
### Initiative 1: Revenue Growth
- Optimize pricing strategy
- Expand upsell/cross-sell programs
- Enter enterprise segment

### Initiative 2: Product Launch
- Complete MVP by October 15
- Beta testing with 10 customers
- General availability by December 1

### Initiative 3: Market Expansion
- Market research for APAC and EMEA
- Localization of key materials
- Partnership agreements

### Initiative 4: Customer Success
- Implement new onboarding flow
- Launch customer health scoring
- Quarterly business reviews for top 50 accounts`,
    version: 1,
    status: "draft",
    author: "Strategy Team",
    reviewers: [],
    tags: ["strategy", "q4", "planning"],
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  documents.set(d1.id, d1);
}

initializeSampleData();

// Mock document analysis
async function analyzeDocumentMock(document: Document): Promise<AnalysisResult> {
  const wordCount = document.content.split(/\s+/).length;
  const readingTime = Math.max(1, Math.floor(wordCount / 200));

  const lines = document.content.split('\n');
  const keyPoints = lines
    .filter(line => line.startsWith('#'))
    .map(line => line.replace(/^#+\s*/, '').trim())
    .slice(0, 10);

  const entities = [
    { type: "ORG", value: "Acme Corp", confidence: 0.9 },
    { type: "DATE", value: "Q4 2024", confidence: 0.95 },
    { type: "MONEY", value: "$2M", confidence: 0.8 },
  ];

  return {
    documentId: document.id,
    summary: `Document '${document.title}' (${wordCount} words) covers strategic planning for Q4.`,
    keyPoints,
    entities,
    sentiment: "positive",
    riskFactors: ["Aggressive timeline for product launch", "Market expansion requires significant investment"],
    recommendations: [
      "Add buffer time for beta testing phase",
      "Secure partnership LOIs before committing to market expansion",
      "Define clear success metrics for each initiative",
    ],
    wordCount,
    readingTimeMin: readingTime,
    analyzedAt: new Date().toISOString(),
  };
}

// Simple template rendering
function renderTemplate(template: Template, variables: Record<string, unknown>): string {
  let content = template.content;

  for (const [key, value] of Object.entries(variables)) {
    content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
  }

  // Replace any remaining unreplaced variables with defaults or placeholder
  content = content.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
    const varDef = template.variables.find(v => v.name === varName);
    if (varDef && 'default' in varDef) return String(varDef.default);
    return `[[${varName}]]`;
  });

  return content;
}

// Create MCP server
const server = new McpServer({
  name: "consultancy-workflow",
  version: "1.0.0",
  capabilities: {
    tools: { listChanged: true },
    resources: { subscribe: true, listChanged: true },
    prompts: { listChanged: true },
    logging: {},
  },
});

// ============================================
// TOOLS - DOCUMENTS
// ============================================

server.tool("create-document", "Create a new document", {
  title: z.string(),
  type: z.enum(["contract", "proposal", "report", "memo", "specification", "policy", "meeting_notes", "email"]),
  content: z.string(),
  author: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
}, async ({ title, type, content, author, tags, metadata }) => {
  const docId = `doc-${Date.now().toString(36)}`;
  const doc: Document = {
    id: docId,
    title,
    type,
    content,
    version: 1,
    status: "draft",
    author: author || "",
    reviewers: [],
    tags: tags || [],
    metadata: metadata || {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  documents.set(docId, doc);
  return { content: [{ type: "text", text: JSON.stringify(doc, null, 2) }] });
});

server.tool("get-document", "Get document", {
  documentId: z.string(),
}, async ({ documentId }) => {
  const doc = documents.get(documentId);
  if (!doc) return { content: [{ type: "text", text: JSON.stringify({ error: "Document not found", documentId }) }], isError: true };
  return { content: [{ type: "text", text: JSON.stringify(doc, null, 2) }] });
});

server.tool("update-document", "Update document", {
  documentId: z.string(),
  title: z.string().optional(),
  content: z.string().optional(),
  status: z.enum(["draft", "in_review", "approved", "rejected", "published", "archived"]).optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
}, async ({ documentId, title, content, status, tags, metadata }) => {
  const doc = documents.get(documentId);
  if (!doc) return { content: [{ type: "text", text: JSON.stringify({ error: "Document not found", documentId }) }], isError: true };

  if (title) doc.title = title;
  if (content) { doc.content = content; doc.version += 1; }
  if (status) doc.status = status;
  if (tags) doc.tags = tags;
  if (metadata) doc.metadata = { ...doc.metadata, ...metadata };

  doc.updatedAt = new Date().toISOString();
  return { content: [{ type: "text", text: JSON.stringify(doc, null, 2) }] });
});

server.tool("list-documents", "List documents", {
  type: z.enum(["contract", "proposal", "report", "memo", "specification", "policy", "meeting_notes", "email"]).optional(),
  status: z.enum(["draft", "in_review", "approved", "rejected", "published", "archived"]).optional(),
  author: z.string().optional(),
  tags: z.array(z.string()).optional(),
}, async ({ type, status, author, tags }) => {
  let result = Array.from(documents.values());
  if (type) result = result.filter(d => d.type === type);
  if (status) result = result.filter(d => d.status === status);
  if (author) result = result.filter(d => d.author === author);
  if (tags) result = result.filter(d => tags.some(t => d.tags.includes(t)));
  return { content: [{ type: "text", text: JSON.stringify({ documents: result, count: result.length }, null, 2) }] });
});

server.tool("analyze-document", "Analyze document content", {
  documentId: z.string(),
  forceRefresh: z.boolean().default(false),
}, async ({ documentId, forceRefresh = false }) => {
  const doc = documents.get(documentId);
  if (!doc) return { content: [{ type: "text", text: JSON.stringify({ error: "Document not found", documentId }) }], isError: true };

  if (analysisCache.has(documentId) && !forceRefresh) {
    return { content: [{ type: "text", text: JSON.stringify(analysisCache.get(documentId), null, 2) }] };
  }

  const analysis = await analyzeDocumentMock(doc);
  analysisCache.set(documentId, analysis);
  return { content: [{ type: "text", text: JSON.stringify(analysis, null, 2) }] });
});

server.tool("compare-documents", "Compare two documents", {
  documentId1: z.string(),
  documentId2: z.string(),
}, async ({ documentId1, documentId2 }) => {
  const doc1 = documents.get(documentId1);
  const doc2 = documents.get(documentId2);

  if (!doc1 || !doc2) return { content: [{ type: "text", text: JSON.stringify({ error: "One or both documents not found" }) }], isError: true };

  const analysis1 = await analyzeDocumentMock(doc1);
  const analysis2 = await analyzeDocumentMock(doc2);

  const entities1 = new Set(analysis1.entities.map(e => e.value));
  const entities2 = new Set(analysis2.entities.map(e => e.value));

  return { content: [{ type: "text", text: JSON.stringify({
    document1: { id: doc1.id, title: doc1.title, wordCount: analysis1.wordCount },
    document2: { id: doc2.id, title: doc2.title, wordCount: analysis2.wordCount },
    similarity: 0.65,
    commonEntities: Array.from(entities1).filter(e => entities2.has(e)),
    uniqueTo1: Array.from(entities1).filter(e => !entities2.has(e)),
    uniqueTo2: Array.from(entities2).filter(e => !entities1.has(e)),
  }, null, 2) }] });
});

// ============================================
// TOOLS - TEMPLATES
// ============================================

server.tool("create-template", "Create a document template", {
  name: z.string(),
  description: z.string(),
  type: z.enum(["contract", "proposal", "report", "memo", "specification", "policy", "meeting_notes", "email"]),
  content: z.string(),
  variables: z.array(z.object({
    name: z.string(),
    type: z.string(),
    description: z.string(),
    required: z.boolean(),
    default: z.unknown().optional(),
    options: z.array(z.string()).optional(),
  })),
  tags: z.array(z.string()).optional(),
}, async ({ name, description, type, content, variables, tags }) => {
  const tplId = `tpl-${Date.now().toString(36)}`;
  const tpl: Template = {
    id: tplId,
    name,
    description,
    type,
    content,
    variables,
    tags: tags || [],
    isActive: true,
    createdBy: "system",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  templates.set(tplId, tpl);
  return { content: [{ type: "text", text: JSON.stringify(tpl, null, 2) }] });
});

server.tool("list-templates", "List templates", {
  type: z.enum(["contract", "proposal", "report", "memo", "specification", "policy", "meeting_notes", "email"]).optional(),
  tags: z.array(z.string()).optional(),
  activeOnly: z.boolean().default(true),
}, async ({ type, tags, activeOnly = true }) => {
  let result = Array.from(templates.values());
  if (activeOnly) result = result.filter(t => t.isActive);
  if (type) result = result.filter(t => t.type === type);
  if (tags) result = result.filter(t => tags.some(tag => t.tags.includes(tag)));
  return { content: [{ type: "text", text: JSON.stringify({ templates: result, count: result.length }, null, 2) }] });
});

server.tool("get-template", "Get template", {
  templateId: z.string(),
}, async ({ templateId }) => {
  const tpl = templates.get(templateId);
  if (!tpl) return { content: [{ type: "text", text: JSON.stringify({ error: "Template not found", templateId }) }], isError: true };
  return { content: [{ type: "text", text: JSON.stringify(tpl, null, 2) }] });
});

server.tool("render-template", "Render template with variables", {
  templateId: z.string(),
  variables: z.record(z.unknown()),
}, async ({ templateId, variables }) => {
  const tpl = templates.get(templateId);
  if (!tpl) return { content: [{ type: "text", text: JSON.stringify({ error: "Template not found", templateId }) }], isError: true };

  for (const v of tpl.variables) {
    if (v.required && !(v.name in variables)) {
      if ('default' in v) variables[v.name] = v.default;
      else return { content: [{ type: "text", text: JSON.stringify({ error: `Missing required variable: ${v.name}` }) }], isError: true };
    }
  }

  const content = renderTemplate(tpl, variables);
  return { content: [{ type: "text", text: JSON.stringify({ templateId, renderedContent: content, variablesUsed: variables }, null, 2) }] });
});

server.tool("create-document-from-template", "Create document from template", {
  templateId: z.string(),
  title: z.string(),
  variables: z.record(z.unknown()),
  author: z.string().optional(),
  tags: z.array(z.string()).optional(),
}, async ({ templateId, title, variables, author, tags }) => {
  const tpl = templates.get(templateId);
  if (!tpl) return { content: [{ type: "text", text: JSON.stringify({ error: "Template not found", templateId }) }], isError: true };

  const renderResult = renderTemplate(tpl, variables);

  const docId = `doc-${Date.now().toString(36)}`;
  const doc: Document = {
    id: docId,
    title,
    type: tpl.type,
    content: renderResult,
    version: 1,
    status: "draft",
    author: author || "",
    reviewers: [],
    tags: [...(tags || []), ...tpl.tags],
    metadata: { templateId },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  documents.set(docId, doc);

  return { content: [{ type: "text", text: JSON.stringify({ ...doc, templateId }, null, 2) }] });
});

// ============================================
// TOOLS - WORKFLOWS
// ============================================

server.tool("create-workflow", "Create a review workflow", {
  name: z.string(),
  description: z.string(),
  documentId: z.string(),
  steps: z.array(z.object({
    name: z.string(),
    assignee: z.string(),
    action: z.string(),
  })),
  createdBy: z.string().optional(),
}, async ({ name, description, documentId, steps, createdBy }) => {
  const doc = documents.get(documentId);
  if (!doc) return { content: [{ type: "text", text: JSON.stringify({ error: "Document not found", documentId }) }], isError: true };

  const wfId = `wf-${Date.now().toString(36)}`;
  const workflow: Workflow = {
    id: wfId,
    name,
    description,
    documentId,
    currentStep: 0,
    steps: steps.map(s => ({ ...s, status: "pending" })),
    status: "in_review",
    createdBy: createdBy || "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (workflow.steps.length > 0) {
    workflow.steps[0].status = "in_progress";
    workflow.steps[0].startedAt = new Date().toISOString();
  }

  workflows.set(wfId, workflow);

  doc.status = "in_review";
  doc.updatedAt = new Date().toISOString();

  return { content: [{ type: "text", text: JSON.stringify(workflow, null, 2) }] });
});

server.tool("get-workflow", "Get workflow", {
  workflowId: z.string(),
}, async ({ workflowId }) => {
  const wf = workflows.get(workflowId);
  if (!wf) return { content: [{ type: "text", text: JSON.stringify({ error: "Workflow not found", workflowId }) }], isError: true };
  return { content: [{ type: "text", text: JSON.stringify(wf, null, 2) }] });
});

server.tool("advance-workflow", "Advance workflow to next step", {
  workflowId: z.string(),
  action: z.enum(["approve", "reject", "request_changes"]),
  comment: z.string().optional(),
}, async ({ workflowId, action, comment }) => {
  const wf = workflows.get(workflowId);
  if (!wf) return { content: [{ type: "text", text: JSON.stringify({ error: "Workflow not found", workflowId }) }], isError: true };

  if (wf.currentStep >= wf.steps.length) {
    return { content: [{ type: "text", text: JSON.stringify({ error: "Workflow already completed" }) }], isError: true };
  }

  const currentStep = wf.steps[wf.currentStep];
  currentStep.status = "completed";
  currentStep.actionTaken = action;
  currentStep.comment = comment || "";
  currentStep.completedAt = new Date().toISOString();

  wf.currentStep += 1;

  if (wf.currentStep >= wf.steps.length) {
    wf.status = action === "approve" ? "approved" : "rejected";
    const doc = documents.get(wf.documentId);
    if (doc) { doc.status = wf.status; doc.updatedAt = new Date().toISOString(); }
  } else {
    wf.status = "in_review";
    const nextStep = wf.steps[wf.currentStep];
    nextStep.status = "in_progress";
    nextStep.startedAt = new Date().toISOString();
  }

  wf.updatedAt = new Date().toISOString();
  return { content: [{ type: "text", text: JSON.stringify(wf, null, 2) }] });
});

// ============================================
// TOOLS - TASKS
// ============================================

server.tool("create-task", "Create a task", {
  title: z.string(),
  description: z.string(),
  assignee: z.string().optional(),
  workflowId: z.string().optional(),
  documentId: z.string().optional(),
  priority: z.number().min(1).max(3).default(3),
  dueDate: z.string().optional(),
  tags: z.array(z.string()).optional(),
}, async ({ title, description, assignee, workflowId, documentId, priority, dueDate, tags }) => {
  const taskId = `task-${Date.now().toString(36)}`;
  const task: Task = {
    id: taskId,
    title,
    description,
    workflowId,
    documentId,
    assignee: assignee || "",
    status: "todo",
    priority,
    dueDate,
    tags: tags || [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  tasks.set(taskId, task);
  return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }] });
});

server.tool("list-tasks", "List tasks", {
  assignee: z.string().optional(),
  status: z.enum(["todo", "in_progress", "blocked", "done"]).optional(),
  workflowId: z.string().optional(),
  documentId: z.string().optional(),
}, async ({ assignee, status, workflowId, documentId }) => {
  let result = Array.from(tasks.values());
  if (assignee) result = result.filter(t => t.assignee === assignee);
  if (status) result = result.filter(t => t.status === status);
  if (workflowId) result = result.filter(t => t.workflowId === workflowId);
  if (documentId) result = result.filter(t => t.documentId === documentId);

  result.sort((a, b) => a.priority - b.priority || (a.dueDate || "zzzzzzzz").localeCompare(b.dueDate || "zzzzzzzz"));

  return { content: [{ type: "text", text: JSON.stringify({ tasks: result, count: result.length }, null, 2) }] });
});

server.tool("update-task", "Update task", {
  taskId: z.string(),
  status: z.enum(["todo", "in_progress", "blocked", "done"]).optional(),
  assignee: z.string().optional(),
  priority: z.number().min(1).max(3).optional(),
  dueDate: z.string().optional(),
}, async ({ taskId, status, assignee, priority, dueDate }) => {
  const task = tasks.get(taskId);
  if (!task) return { content: [{ type: "text", text: JSON.stringify({ error: "Task not found", taskId }) }], isError: true };

  if (status) task.status = status;
  if (assignee) task.assignee = assignee;
  if (priority) task.priority = priority;
  if (dueDate) task.dueDate = dueDate;

  task.updatedAt = new Date().toISOString();
  return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }] });
});

// ============================================
// RESOURCES
// ============================================

server.resource("document://{documentId}", "Document", async (uri) => {
  const doc = documents.get(uri.params.documentId);
  if (!doc) throw new Error(`Document not found: ${uri.params.documentId}`);
  return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(doc, null, 2) }] });
});

server.resource("template://{templateId}", "Template", async (uri) => {
  const tpl = templates.get(uri.params.templateId);
  if (!tpl) throw new Error(`Template not found: ${uri.params.templateId}`);
  return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(tpl, null, 2) }] });
});

server.resource("workflow://{workflowId}", "Workflow", async (uri) => {
  const wf = workflows.get(uri.params.workflowId);
  if (!wf) throw new Error(`Workflow not found: ${uri.params.workflowId}`);
  return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(wf, null, 2) }] });
});

server.resource("task://{taskId}", "Task", async (uri) => {
  const task = tasks.get(uri.params.taskId);
  if (!task) throw new Error(`Task not found: ${uri.params.taskId}`);
  return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(task, null, 2) }] });
});

server.resource("analysis://{documentId}", "Document Analysis", async (uri) => {
  const doc = documents.get(uri.params.documentId);
  if (!doc) throw new Error(`Document not found: ${uri.params.documentId}`);

  if (!analysisCache.has(uri.params.documentId)) {
    analysisCache.set(uri.params.documentId, await analyzeDocumentMock(doc));
  }
  return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(analysisCache.get(uri.params.documentId), null, 2) }] });
});

// ============================================
// PROMPTS
// ============================================

server.prompt("document-review", "Document review prompt", {
  documentId: z.string(),
  reviewType: z.enum(["general", "legal", "technical", "financial"]).default("general"),
  focusAreas: z.array(z.string()).optional(),
}, async ({ documentId, reviewType, focusAreas }) => {
  const doc = documents.get(documentId);
  if (!doc) return { messages: [{ role: "user", content: "Document not found." }] };

  const analysis = await analyzeDocumentMock(doc);

  return {
    messages: [
      { role: "system", content: `You are a ${reviewType} reviewer. Review this document thoroughly.` },
      { role: "user", content: `Document: ${doc.title}\nType: ${doc.type}\nAuthor: ${doc.author}\n\nContent:\n${doc.content.slice(0, 3000)}...\n\nAnalysis Summary:\n${analysis.summary}\n\nKey Points:\n${analysis.keyPoints.join('\n')}\n\nRisk Factors:\n${analysis.riskFactors.join('\n')}\n\nFocus Areas: ${focusAreas?.join(', ') || 'General review'}\n\nProvide: overall assessment, specific issues, recommendations, risk assessment, approval recommendation.` }
    ]
  };
});

server.prompt("proposal-generation", "Generate consulting proposal", {
  clientName: z.string(),
  projectDescription: z.string(),
  keyObjectives: z.array(z.string()),
  timeline: z.string(),
  budgetRange: z.string(),
  teamComposition: z.string().optional(),
}, async ({ clientName, projectDescription, keyObjectives, timeline, budgetRange, teamComposition }) => ({
  messages: [
    { role: "system", content: "You are a senior consultant writing winning proposals. Be specific, value-focused, and professional." },
    { role: "user", content: `Create a compelling consulting proposal for ${clientName}.\n\nProject: ${projectDescription}\nKey Objectives:\n${keyObjectives.map(o => `- ${o}`).join('\n')}\n\nTimeline: ${timeline}\nBudget Range: ${budgetRange}\nTeam: ${teamComposition || 'To be determined'}\n\nStructure with: Executive Summary, Understanding of Client Needs, Proposed Approach, Detailed Scope, Timeline & Milestones, Team, Investment, Why Us, Next Steps.` }
  ]
}));

server.prompt("meeting-summary", "Generate meeting summary", {
  meetingTitle: z.string(),
  attendees: z.array(z.string()),
  notes: z.string(),
  actionItems: z.array(z.string()),
  decisions: z.array(z.string()),
}, async ({ meetingTitle, attendees, notes, actionItems, decisions }) => ({
  messages: [
    { role: "system", content: "You are an executive assistant creating clear, actionable meeting summaries." },
    { role: "user", content: `Create a professional meeting summary.\n\nMeeting: ${meetingTitle}\nAttendees: ${attendees.join(', ')}\n\nNotes:\n${notes}\n\nDecisions Made:\n${decisions.map(d => `- ${d}`).join('\n')}\n\nAction Items:\n${actionItems.map(a => `- ${a}`).join('\n')}\n\nFormat as: Meeting Overview, Key Discussion Points, Decisions, Action Items (with owners and due dates), Next Meeting.` }
  ]
}));

// ============================================
// HEALTH CHECK
// ============================================

server.tool("health", "Health check", {}, async () => ({
  content: [{ type: "text", text: JSON.stringify({
    status: "healthy",
    timestamp: new Date().toISOString(),
    documents: documents.size,
    templates: templates.size,
    workflows: workflows.size,
    tasks: tasks.size,
    analysesCached: analysisCache.size,
  }, null, 2) }]
}));

// Start server
async function main() {
  const transport = process.env.MCP_TRANSPORT || "websocket";
  const port = parseInt(process.env.MCP_PORT || "3000", 10);
  const host = process.env.MCP_HOST || "0.0.0.0";

  console.error(`Starting consultancy-workflow on ${transport}...`);

  if (transport === "websocket") await server.start({ transport: "websocket", port, host });
  else if (transport === "http-sse") await server.start({ transport: "http-sse", port, host });
  else if (transport === "grpc") await server.start({ transport: "grpc", port, host });
  else await server.start({ transport: "stdio" });

  console.error("Consultancy workflow server started");
}

main().catch((e) => { console.error("Failed:", e); process.exit(1); });
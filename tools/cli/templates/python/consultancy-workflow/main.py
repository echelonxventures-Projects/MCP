#!/usr/bin/env python3
"""
Consultancy Workflow MCP Server
Document analysis, template generation, report creation, and workflow automation
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

class DocumentType(str, Enum):
    CONTRACT = "contract"
    PROPOSAL = "proposal"
    REPORT = "report"
    MEMO = "memo"
    SPEC = "specification"
    POLICY = "policy"
    MEETING_NOTES = "meeting_notes"
    EMAIL = "email"


class WorkflowStatus(str, Enum):
    DRAFT = "draft"
    IN_REVIEW = "in_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    PUBLISHED = "published"
    ARCHIVED = "archived"


class TaskStatus(str, Enum):
    TODO = "todo"
    IN_PROGRESS = "in_progress"
    BLOCKED = "blocked"
    DONE = "done"


@dataclass
class Document:
    id: str
    title: str
    type: DocumentType
    content: str
    version: int = 1
    status: WorkflowStatus = WorkflowStatus.DRAFT
    author: str = ""
    reviewers: List[str] = field(default_factory=list)
    tags: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())


@dataclass
class Template:
    id: str
    name: str
    description: str
    type: DocumentType
    content: str  # Template with placeholders like {{variable}}
    variables: List[Dict[str, Any]] = field(default_factory=list)  # name, type, description, required, default
    tags: List[str] = field(default_factory=list)
    is_active: bool = True
    created_by: str = ""
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())


@dataclass
class Workflow:
    id: str
    name: str
    description: str
    document_id: str
    current_step: int = 0
    steps: List[Dict[str, Any]] = field(default_factory=list)  # name, assignee, action, status
    status: WorkflowStatus = WorkflowStatus.DRAFT
    created_by: str = ""
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())


@dataclass
class Task:
    id: str
    title: str
    description: str
    workflow_id: Optional[str] = None
    document_id: Optional[str] = None
    assignee: str = ""
    status: TaskStatus = TaskStatus.TODO
    priority: int = 3  # 1=high, 2=medium, 3=low
    due_date: Optional[str] = None
    tags: List[str] = field(default_factory=list)
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())


@dataclass
class AnalysisResult:
    document_id: str
    summary: str
    key_points: List[str]
    entities: List[Dict[str, Any]]
    sentiment: str
    risk_factors: List[str]
    recommendations: List[str]
    word_count: int
    reading_time_min: int
    analyzed_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())


# ============================================
# IN-MEMORY STORES
# ============================================

documents: Dict[str, Document] = {}
templates: Dict[str, Template] = {}
workflows: Dict[str, Workflow] = {}
tasks: Dict[str, Task] = {}
analysis_cache: Dict[str, AnalysisResult] = {}


def initialize_sample_data():
    """Initialize sample consultancy data."""
    # Sample templates
    t1 = Template(
        id="tpl-001",
        name="Consulting Proposal",
        description="Standard consulting proposal template",
        type=DocumentType.PROPOSAL,
        content="""# {{project_name}} Consulting Proposal

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
{{terms}}""",
        variables=[
            {"name": "project_name", "type": "string", "description": "Project name", "required": True},
            {"name": "client_name", "type": "string", "description": "Client name", "required": True},
            {"name": "date", "type": "date", "description": "Proposal date", "required": True, "default": datetime.utcnow().strftime("%Y-%m-%d")},
            {"name": "consultant_name", "type": "string", "description": "Consultant name", "required": True},
            {"name": "executive_summary", "type": "text", "description": "Executive summary", "required": True},
            {"name": "scope_of_work", "type": "text", "description": "Scope of work", "required": True},
            {"name": "timeline", "type": "text", "description": "Project timeline", "required": True},
            {"name": "investment", "type": "text", "description": "Investment details", "required": True},
            {"name": "terms", "type": "text", "description": "Terms and conditions", "required": False, "default": "Standard terms apply."},
        ],
        tags=["proposal", "consulting", "standard"],
    )

    t2 = Template(
        id="tpl-002",
        name="Project Status Report",
        description="Weekly project status report",
        type=DocumentType.REPORT,
        content="""# {{project_name}} - Status Report

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
{{next_steps}}""",
        variables=[
            {"name": "project_name", "type": "string", "description": "Project name", "required": True},
            {"name": "period_start", "type": "date", "description": "Period start date", "required": True},
            {"name": "period_end", "type": "date", "description": "Period end date", "required": True},
            {"name": "report_date", "type": "date", "description": "Report date", "required": True, "default": datetime.utcnow().strftime("%Y-%m-%d")},
            {"name": "pm_name", "type": "string", "description": "Project manager name", "required": True},
            {"name": "overall_status", "type": "choice", "description": "Overall status", "required": True, "options": ["On Track", "At Risk", "Off Track"]},
            {"name": "accomplishments", "type": "text", "description": "Key accomplishments", "required": True},
            {"name": "priorities", "type": "text", "description": "Upcoming priorities", "required": True},
            {"name": "risks", "type": "text", "description": "Risks and issues", "required": False, "default": "None identified."},
            {"name": "budget_status", "type": "text", "description": "Budget status", "required": True},
            {"name": "next_steps", "type": "text", "description": "Next steps", "required": True},
        ],
        tags=["report", "status", "weekly"],
    )

    templates[t1.id] = t1
    templates[t2.id] = t2

    # Sample document
    d1 = Document(
        id="doc-001",
        title="Q4 Strategic Plan",
        type=DocumentType.REPORT,
        content="""# Q4 Strategic Plan

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
- Quarterly business reviews for top 50 accounts""",
        author="Strategy Team",
        tags=["strategy", "q4", "planning"],
    )
    documents[d1.id] = d1


initialize_sample_data()


# ============================================
# DOCUMENT ANALYSIS (MOCK)
# ============================================

async def analyze_document_mock(document: Document) -> AnalysisResult:
    """Mock document analysis."""
    word_count = len(document.content.split())
    reading_time = max(1, word_count // 200)

    # Extract key points (simple heuristic)
    lines = document.content.split('\n')
    key_points = [line.replace('#', '').strip() for line in lines if line.startswith('#')][:10]

    # Mock entities
    entities = [
        {"type": "ORG", "value": "Acme Corp", "confidence": 0.9},
        {"type": "DATE", "value": "Q4 2024", "confidence": 0.95},
        {"type": "MONEY", "value": "$2M", "confidence": 0.8},
    ]

    return AnalysisResult(
        document_id=document.id,
        summary=f"Document '{document.title}' ({word_count} words) covers strategic planning for Q4.",
        key_points=key_points,
        entities=entities,
        sentiment="positive",
        risk_factors=["Aggressive timeline for product launch", "Market expansion requires significant investment"],
        recommendations=[
            "Add buffer time for beta testing phase",
            "Secure partnership LOIs before committing to market expansion",
            "Define clear success metrics for each initiative",
        ],
        word_count=word_count,
        reading_time_min=reading_time,
    )


# ============================================
# MCP SERVER
# ============================================

server = McpServer(
    name="consultancy-workflow",
    version="1.0.0",
    capabilities={
        "tools": {"listChanged": True},
        "resources": {"subscribe": True, "listChanged": True},
        "prompts": {"listChanged": True},
        "logging": {},
    },
)


# ============================================
# TOOLS - DOCUMENTS
# ============================================

@server.tool("create-document", "Create a new document")
async def create_document(
    title: str,
    type: str,
    content: str,
    author: str = "",
    tags: Optional[List[str]] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Create a new document."""
    doc_id = f"doc-{uuid.uuid4().hex[:8]}"
    doc = Document(
        id=doc_id,
        title=title,
        type=DocumentType(type),
        content=content,
        author=author,
        tags=tags or [],
        metadata=metadata or {},
    )
    documents[doc_id] = doc
    return doc.__dict__


@server.tool("get-document", "Get document")
async def get_document(document_id: str) -> Dict[str, Any]:
    """Get document by ID."""
    doc = documents.get(document_id)
    if not doc:
        return {"error": "Document not found", "document_id": document_id}
    return doc.__dict__


@server.tool("update-document", "Update document")
async def update_document(
    document_id: str,
    title: Optional[str] = None,
    content: Optional[str] = None,
    status: Optional[str] = None,
    tags: Optional[List[str]] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Update document."""
    doc = documents.get(document_id)
    if not doc:
        return {"error": "Document not found", "document_id": document_id}

    if title:
        doc.title = title
    if content:
        doc.content = content
        doc.version += 1
    if status:
        doc.status = WorkflowStatus(status)
    if tags:
        doc.tags = tags
    if metadata:
        doc.metadata.update(metadata)

    doc.updated_at = datetime.utcnow().isoformat()
    return doc.__dict__


@server.tool("list-documents", "List documents")
async def list_documents(
    type: Optional[str] = None,
    status: Optional[str] = None,
    author: Optional[str] = None,
    tags: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """List documents with filters."""
    result = list(documents.values())

    if type:
        result = [d for d in result if d.type.value == type]
    if status:
        result = [d for d in result if d.status.value == status]
    if author:
        result = [d for d in result if d.author == author]
    if tags:
        result = [d for d in result if any(t in d.tags for t in tags)]

    return {"documents": [d.__dict__ for d in result], "count": len(result)}


@server.tool("analyze-document", "Analyze document content")
async def analyze_document(document_id: str, force_refresh: bool = False) -> Dict[str, Any]:
    """Analyze document using NLP."""
    doc = documents.get(document_id)
    if not doc:
        return {"error": "Document not found", "document_id": document_id}

    if document_id in analysis_cache and not force_refresh:
        return analysis_cache[document_id].__dict__

    analysis = await analyze_document_mock(doc)
    analysis_cache[document_id] = analysis
    return analysis.__dict__


@server.tool("compare-documents", "Compare two documents")
async def compare_documents(document_id_1: str, document_id_2: str) -> Dict[str, Any]:
    """Compare two documents."""
    doc1 = documents.get(document_id_1)
    doc2 = documents.get(document_id_2)

    if not doc1 or not doc2:
        return {"error": "One or both documents not found"}

    analysis1 = await analyze_document(document_id_1)
    analysis2 = await analyze_document(document_id_2)

    return {
        "document_1": {"id": doc1.id, "title": doc1.title, "word_count": analysis1["word_count"]},
        "document_2": {"id": doc2.id, "title": doc2.title, "word_count": analysis2["word_count"]},
        "similarity": 0.65,  # Mock similarity score
        "common_entities": list(set(e["value"] for e in analysis1["entities"]) & set(e["value"] for e in analysis2["entities"])),
        "unique_to_1": list(set(e["value"] for e in analysis1["entities"]) - set(e["value"] for e in analysis2["entities"])),
        "unique_to_2": list(set(e["value"] for e in analysis2["entities"]) - set(e["value"] for e in analysis1["entities"])),
    }


# ============================================
# TOOLS - TEMPLATES
# ============================================

@server.tool("create-template", "Create a document template")
async def create_template(
    name: str,
    description: str,
    type: str,
    content: str,
    variables: List[Dict[str, Any]],
    tags: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Create a document template."""
    tpl_id = f"tpl-{uuid.uuid4().hex[:8]}"
    tpl = Template(
        id=tpl_id,
        name=name,
        description=description,
        type=DocumentType(type),
        content=content,
        variables=variables,
        tags=tags or [],
    )
    templates[tpl_id] = tpl
    return tpl.__dict__


@server.tool("list-templates", "List templates")
async def list_templates(
    type: Optional[str] = None,
    tags: Optional[List[str]] = None,
    active_only: bool = True,
) -> Dict[str, Any]:
    """List templates."""
    result = list(templates.values())
    if active_only:
        result = [t for t in result if t.is_active]
    if type:
        result = [t for t in result if t.type.value == type]
    if tags:
        result = [t for t in result if any(tag in t.tags for tag in tags)]
    return {"templates": [t.__dict__ for t in result], "count": len(result)}


@server.tool("get-template", "Get template")
async def get_template(template_id: str) -> Dict[str, Any]:
    """Get template by ID."""
    tpl = templates.get(template_id)
    if not tpl:
        return {"error": "Template not found", "template_id": template_id}
    return tpl.__dict__


@server.tool("render-template", "Render template with variables")
async def render_template(template_id: str, variables: Dict[str, Any]) -> Dict[str, Any]:
    """Render template with provided variables."""
    tpl = templates.get(template_id)
    if not tpl:
        return {"error": "Template not found", "template_id": template_id}

    # Validate required variables
    for var in tpl.variables:
        if var.get("required", False) and var["name"] not in variables:
            if "default" in var:
                variables[var["name"]] = var["default"]
            else:
                return {"error": f"Missing required variable: {var['name']}"}

    # Simple template rendering
    content = tpl.content
    for key, value in variables.items():
        content = content.replace(f"{{{{{key}}}}}", str(value))

    # Replace any remaining unreplaced variables with defaults or empty
    import re
    def replace_var(match):
        var_name = match.group(1)
        for var in tpl.variables:
            if var["name"] == var_name and "default" in var:
                return str(var["default"])
        return f"[{{{var_name}}}]"

    content = re.sub(r"\{\{(\w+)\}\}", replace_var, content)

    return {
        "template_id": template_id,
        "rendered_content": content,
        "variables_used": variables,
    }


@server.tool("create-document-from-template", "Create document from template")
async def create_document_from_template(
    template_id: str,
    title: str,
    variables: Dict[str, Any],
    author: str = "",
    tags: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Create a document from a template."""
    render_result = await render_template(template_id, variables)
    if "error" in render_result:
        return render_result

    tpl = templates[template_id]
    doc = await create_document(
        title=title,
        type=tpl.type.value,
        content=render_result["rendered_content"],
        author=author,
        tags=(tags or []) + tpl.tags,
    )
    doc["template_id"] = template_id
    return doc


# ============================================
# TOOLS - WORKFLOWS
# ============================================

@server.tool("create-workflow", "Create a review workflow")
async def create_workflow(
    name: str,
    description: str,
    document_id: str,
    steps: List[Dict[str, Any]],
    created_by: str = "",
) -> Dict[str, Any]:
    """Create a review/approval workflow."""
    doc = documents.get(document_id)
    if not doc:
        return {"error": "Document not found", "document_id": document_id}

    wf_id = f"wf-{uuid.uuid4().hex[:8]}"
    workflow = Workflow(
        id=wf_id,
        name=name,
        description=description,
        document_id=document_id,
        steps=steps,
        created_by=created_by,
    )
    workflows[wf_id] = workflow

    # Update document status
    doc.status = WorkflowStatus.IN_REVIEW
    doc.updated_at = datetime.utcnow().isoformat()

    return workflow.__dict__


@server.tool("get-workflow", "Get workflow")
async def get_workflow(workflow_id: str) -> Dict[str, Any]:
    """Get workflow by ID."""
    wf = workflows.get(workflow_id)
    if not wf:
        return {"error": "Workflow not found", "workflow_id": workflow_id}
    return wf.__dict__


@server.tool("advance-workflow", "Advance workflow to next step")
async def advance_workflow(
    workflow_id: str,
    action: str,  # approve, reject, request_changes
    comment: str = "",
) -> Dict[str, Any]:
    """Advance workflow step."""
    wf = workflows.get(workflow_id)
    if not wf:
        return {"error": "Workflow not found", "workflow_id": workflow_id}

    if wf.current_step >= len(wf.steps):
        return {"error": "Workflow already completed"}

    current_step = wf.steps[wf.current_step]
    current_step["status"] = "completed"
    current_step["action_taken"] = action
    current_step["comment"] = comment
    current_step["completed_at"] = datetime.utcnow().isoformat()

    wf.current_step += 1

    if wf.current_step >= len(wf.steps):
        wf.status = WorkflowStatus.APPROVED if action == "approve" else WorkflowStatus.REJECTED
        doc = documents.get(wf.document_id)
        if doc:
            doc.status = wf.status
            doc.updated_at = datetime.utcnow().isoformat()
    else:
        wf.status = WorkflowStatus.IN_REVIEW
        next_step = wf.steps[wf.current_step]
        next_step["status"] = "in_progress"
        next_step["started_at"] = datetime.utcnow().isoformat()

    wf.updated_at = datetime.utcnow().isoformat()
    return wf.__dict__


# ============================================
# TOOLS - TASKS
# ============================================

@server.tool("create-task", "Create a task")
async def create_task(
    title: str,
    description: str,
    assignee: str = "",
    workflow_id: Optional[str] = None,
    document_id: Optional[str] = None,
    priority: int = 3,
    due_date: Optional[str] = None,
    tags: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Create a task."""
    task_id = f"task-{uuid.uuid4().hex[:8]}"
    task = Task(
        id=task_id,
        title=title,
        description=description,
        workflow_id=workflow_id,
        document_id=document_id,
        assignee=assignee,
        priority=priority,
        due_date=due_date,
        tags=tags or [],
    )
    tasks[task_id] = task
    return task.__dict__


@server.tool("list-tasks", "List tasks")
async def list_tasks(
    assignee: Optional[str] = None,
    status: Optional[str] = None,
    workflow_id: Optional[str] = None,
    document_id: Optional[str] = None,
) -> Dict[str, Any]:
    """List tasks with filters."""
    result = list(tasks.values())

    if assignee:
        result = [t for t in result if t.assignee == assignee]
    if status:
        result = [t for t in result if t.status.value == status]
    if workflow_id:
        result = [t for t in result if t.workflow_id == workflow_id]
    if document_id:
        result = [t for t in result if t.document_id == document_id]

    # Sort by priority then due date
    result.sort(key=lambda t: (t.priority, t.due_date or "zzzzzzzz"))

    return {"tasks": [t.__dict__ for t in result], "count": len(result)}


@server.tool("update-task", "Update task")
async def update_task(
    task_id: str,
    status: Optional[str] = None,
    assignee: Optional[str] = None,
    priority: Optional[int] = None,
    due_date: Optional[str] = None,
) -> Dict[str, Any]:
    """Update task."""
    task = tasks.get(task_id)
    if not task:
        return {"error": "Task not found", "task_id": task_id}

    if status:
        task.status = TaskStatus(status)
    if assignee:
        task.assignee = assignee
    if priority:
        task.priority = priority
    if due_date:
        task.due_date = due_date

    task.updated_at = datetime.utcnow().isoformat()
    return task.__dict__


# ============================================
# RESOURCES
# ============================================

@server.resource("document://{document_id}", "Document")
async def document_resource(document_id: str) -> Dict[str, Any]:
    """Document resource."""
    doc = documents.get(document_id)
    if not doc:
        raise ValueError(f"Document not found: {document_id}")
    return doc.__dict__


@server.resource("template://{template_id}", "Template")
async def template_resource(template_id: str) -> Dict[str, Any]:
    """Template resource."""
    tpl = templates.get(template_id)
    if not tpl:
        raise ValueError(f"Template not found: {template_id}")
    return tpl.__dict__


@server.resource("workflow://{workflow_id}", "Workflow")
async def workflow_resource(workflow_id: str) -> Dict[str, Any]:
    """Workflow resource."""
    wf = workflows.get(workflow_id)
    if not wf:
        raise ValueError(f"Workflow not found: {workflow_id}")
    return wf.__dict__


@server.resource("task://{task_id}", "Task")
async def task_resource(task_id: str) -> Dict[str, Any]:
    """Task resource."""
    task = tasks.get(task_id)
    if not task:
        raise ValueError(f"Task not found: {task_id}")
    return task.__dict__


@server.resource("analysis://{document_id}", "Document Analysis")
async def analysis_resource(document_id: str) -> Dict[str, Any]:
    """Document analysis resource."""
    if document_id not in analysis_cache:
        doc = documents.get(document_id)
        if not doc:
            raise ValueError(f"Document not found: {document_id}")
        analysis_cache[document_id] = await analyze_document_mock(doc)
    return analysis_cache[document_id].__dict__


# ============================================
# PROMPTS
# ============================================

@server.prompt("document-review", "Document review prompt")
async def document_review_prompt(
    document_id: str,
    review_type: str = "general",  # general, legal, technical, financial
    focus_areas: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Generate document review prompt."""
    doc = documents.get(document_id)
    if not doc:
        return {"messages": [{"role": "user", "content": "Document not found."}]}

    analysis = await analyze_document(document_id)

    prompt = f"""You are a {review_type} reviewer. Review this document thoroughly.

Document: {doc.title}
Type: {doc.type.value}
Author: {doc.author}

Content:
{doc.content[:3000]}...

Analysis Summary:
{analysis.get('summary', '')}

Key Points:
{chr(10).join(analysis.get('key_points', []))}

Risk Factors:
{chr(10).join(analysis.get('risk_factors', []))}

Focus Areas: {', '.join(focus_areas) if focus_areas else 'General review'}

Provide:
1. Overall assessment
2. Specific issues found (with location references)
3. Recommendations for improvement
4. Risk assessment
5. Approval recommendation (approve/request changes/reject)"""

    return {
        "messages": [
            {"role": "system", "content": f"You are an expert {review_type} reviewer. Be thorough, constructive, and specific."},
            {"role": "user", "content": prompt},
        ]
    }


@server.prompt("proposal-generation", "Generate consulting proposal")
async def proposal_generation_prompt(
    client_name: str,
    project_description: str,
    key_objectives: List[str],
    timeline: str,
    budget_range: str,
    team_composition: str = "",
) -> Dict[str, Any]:
    """Generate consulting proposal prompt."""
    prompt = f"""Create a compelling consulting proposal for {client_name}.

Project: {project_description}
Key Objectives:
{chr(10).join(f"- {obj}" for obj in key_objectives)}

Timeline: {timeline}
Budget Range: {budget_range}
Team: {team_composition or 'To be determined'}

Structure the proposal with:
1. Executive Summary
2. Understanding of Client Needs
3. Proposed Approach & Methodology
4. Detailed Scope of Work
5. Timeline & Milestones
6. Team Composition
7. Investment & Payment Terms
8. Why Us / Differentiators
9. Next Steps

Make it professional, persuasive, and tailored to the client."""

    return {
        "messages": [
            {"role": "system", "content": "You are a senior consultant writing winning proposals. Be specific, value-focused, and professional."},
            {"role": "user", "content": prompt},
        ]
    }


@server.prompt("meeting-summary", "Generate meeting summary")
async def meeting_summary_prompt(
    meeting_title: str,
    attendees: List[str],
    notes: str,
    action_items: List[str],
    decisions: List[str],
) -> Dict[str, Any]:
    """Generate meeting summary prompt."""
    prompt = f"""Create a professional meeting summary.

Meeting: {meeting_title}
Attendees: {', '.join(attendees)}

Notes:
{notes}

Decisions Made:
{chr(10).join(f"- {d}" for d in decisions)}

Action Items:
{chr(10).join(f"- {a}" for a in action_items)}

Format as:
1. Meeting Overview
2. Key Discussion Points
3. Decisions
4. Action Items (with owners and due dates)
5. Next Meeting"""

    return {
        "messages": [
            {"role": "system", "content": "You are an executive assistant creating clear, actionable meeting summaries."},
            {"role": "user", "content": prompt},
        ]
    }


# ============================================
# HEALTH CHECK
# ============================================

@server.tool("health", "Health check")
async def health() -> Dict[str, Any]:
    """Health check endpoint."""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "documents": len(documents),
        "templates": len(templates),
        "workflows": len(workflows),
        "tasks": len(tasks),
        "analyses_cached": len(analysis_cache),
    }


# ============================================
# MAIN
# ============================================

async def main():
    transport = os.getenv("MCP_TRANSPORT", "websocket")
    port = int(os.getenv("MCP_PORT", "3000"))
    host = os.getenv("MCP_HOST", "0.0.0.0")

    print(f"Starting consultancy-workflow on {transport}...", file=sys.stderr)

    if transport == "websocket":
        await server.start(transport="websocket", port=port, host=host)
    elif transport == "http-sse":
        await server.start(transport="http-sse", port=port, host=host)
    elif transport == "grpc":
        await server.start(transport="grpc", port=port, host=host)
    else:
        await server.start(transport="stdio")

    print("Consultancy workflow server started", file=sys.stderr)


if __name__ == "__main__":
    import sys
    asyncio.run(main())
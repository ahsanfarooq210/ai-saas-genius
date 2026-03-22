"""Architect sub-graph: draft architecture, complexity, and a minimal diagram artifact."""

from __future__ import annotations

import json
import re

from langchain_core.prompts import ChatPromptTemplate
from langgraph.graph import END, StateGraph

from app.agent.llm import llm_gemini
from app.agent.message_content import message_content_to_str
from app.agent.state.global_swarm_state import DiagramEntry, GlobalSwarmState
from app.agent.streaming import emit_custom_event
from app.services.uploadthing_service import UploadThingService

ARCHITECT_PROMPT = """You are a senior systems architect.

User requirement:
{task_requirement}

Respond with ONLY a single JSON object (no markdown fences) using exactly these keys:
- "mermaid": string — valid Mermaid diagram source for a high-level system view (flowchart or graph)
- "architecture_json": object — must include "components" (array of objects with "name", "description") and may include "connections", "data_stores", etc.
- "component_list": array of short strings — major components or services
- "complexity_score": integer from 1 to 10 — overall system complexity
- "diagram_plan": array of diagram id strings to generate later, e.g. ["overview", "auth-flow"]
- "doc_plan": array of suggested doc filenames, e.g. ["overview.md"] — may be empty

Keep the Mermaid syntax valid and concise.
"""


def _strip_json_fence(raw: str) -> str:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _fallback_architecture(task: str) -> dict:
    return {
        "mermaid": (
            "flowchart LR\n"
            "  U[Users] --> API[API]\n"
            "  API --> S[Services]\n"
            "  S --> D[(Data)]\n"
        ),
        "architecture_json": {
            "components": [
                {"name": "API", "description": "Entry point"},
                {"name": "Services", "description": "Core logic"},
                {"name": "Data", "description": "Persistence"},
            ],
            "note": "Fallback draft — refine in next iteration.",
        },
        "component_list": ["API", "Services", "Data"],
        "complexity_score": 5,
        "diagram_plan": ["overview"],
        "doc_plan": [],
    }


async def architect_node(state: GlobalSwarmState) -> dict:
    emit_custom_event(
        {
            "event": "item_started",
            "type": "progress",
            "stage": "architect",
            "status": "started",
            "item_type": "diagram",
            "item_name": "overview",
            "message": "Drafting architecture and overview diagram",
        }
    )

    prompt = ChatPromptTemplate.from_template(ARCHITECT_PROMPT)
    chain = prompt | llm_gemini
    response = await chain.ainvoke({"task_requirement": state["task_requirement"]})
    raw = _strip_json_fence(message_content_to_str(response.content))

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        data = _fallback_architecture(state["task_requirement"])

    mermaid = str(data.get("mermaid") or "").strip() or _fallback_architecture("")["mermaid"]
    arch_json = data.get("architecture_json")
    if not isinstance(arch_json, dict):
        arch_json = {"components": []}

    components = data.get("component_list")
    if not isinstance(components, list) or not components:
        components = [
            c.get("name", "Component")
            for c in arch_json.get("components", [])
            if isinstance(c, dict)
        ] or ["Core"]

    try:
        complexity = int(data.get("complexity_score", 5))
    except (TypeError, ValueError):
        complexity = 5
    complexity = max(1, min(10, complexity))

    diagram_plan = data.get("diagram_plan")
    if not isinstance(diagram_plan, list) or not diagram_plan:
        diagram_plan = ["overview"]

    doc_plan = data.get("doc_plan")
    if not isinstance(doc_plan, list):
        doc_plan = []

    iteration = int(state.get("iteration_count", 0) or 0)
    thread_id = state["thread_id"]
    path = f"diagrams/{thread_id}/iter{iteration}_overview.mmd"

    await UploadThingService().upload_file(path, mermaid)

    overview: DiagramEntry = {
        "diagram_type": "overview",
        "content": mermaid,
        "path": path,
        "iteration": iteration,
    }

    diagram_plan_str = [str(x) for x in diagram_plan]
    doc_plan_str = [str(x) for x in doc_plan]
    total_d = len(diagram_plan_str)

    emit_custom_event(
        {
            "event": "item_completed",
            "type": "progress",
            "stage": "architect",
            "status": "completed",
            "item_type": "diagram",
            "item_name": "overview",
            "message": f"Architecture complete. Complexity {complexity}/10.",
            "path": path,
            "complexity_score": complexity,
            "total_diagram_count": total_d,
            "completed_diagram_count": 1,
        }
    )

    return {
        "current_architecture_mermaid": mermaid,
        "architecture_json": arch_json,
        "component_list": [str(x) for x in components],
        "complexity_score": complexity,
        "diagram_plan": diagram_plan_str,
        "doc_plan": doc_plan_str,
        "generated_diagrams": [overview],
        "current_stage": "architect",
        "current_task": "Architecture drafted",
        "progress_message": f"Architecture complete. Complexity {complexity}/10.",
        "active_item_type": "diagram",
        "active_item_name": "overview",
        "completed_diagram_count": 1,
        "total_diagram_count": total_d,
        "total_doc_count": len(doc_plan_str),
    }


def build_architect_graph():
    graph = StateGraph(GlobalSwarmState)
    graph.add_node("architect_node", architect_node)
    graph.set_entry_point("architect_node")
    graph.add_edge("architect_node", END)
    return graph.compile()


architect_graph = build_architect_graph()

# graph/doc_generator_graph.py
import json
import re

from app.agent.llm import llm_gemini
from langchain_core.prompts import ChatPromptTemplate
from langgraph.graph import StateGraph, END
from langgraph.types import Send

from app.agent.state.doc_worker_state import DocWorkerState
from app.agent.state.global_swarm_state import DocEntry, GlobalSwarmState
from app.services.uploadthing_service import UploadThingService

# from app.agent.storage.file_store import FileStore

# file_store = FileStore()

# ─────────────────────────────────────────────────────────────────────────────
# PROMPTS
# ─────────────────────────────────────────────────────────────────────────────

DOC_PLANNER_PROMPT = """
You are a technical documentation planner. Based on the architecture below,
decide exactly which Markdown documents need to be written.

Architecture JSON:
{architecture_json}

Component list:
{component_list}

Complexity score: {complexity_score} / 10

Rules:
- Score 1–3  → produce: overview.md only
- Score 4–6  → produce: overview.md + one file per major component + any ADRs for non-obvious decisions
- Score 7–10 → produce: overview.md + one file per component + ADRs + runbooks for critical paths

Respond ONLY with a valid JSON array of filename slugs. No explanation, no markdown
fences, no extra text. Example:
["overview.md", "auth-service.md", "adr-caching-strategy.md", "runbook-incident-response.md"]
"""

DOC_WRITER_PROMPT = """
You are a senior software architect writing technical documentation.

Write the Markdown document for: {doc_slug}

Context you have access to:
- Original requirement: {task_requirement}
- Full architecture JSON: {architecture_json}
- Component list: {component_list}
- Generated diagrams (reference these where relevant): {diagrams_summary}

Document type guide:
- overview.md        → executive summary, system purpose, key design decisions, high-level diagram reference
- {component}.md     → component responsibilities, interfaces, data flow, dependencies, failure modes
- adr-{title}.md     → Architecture Decision Record: context, decision, consequences, alternatives considered
- runbook-{title}.md → step-by-step operational guide: when to use, prerequisites, steps, rollback

Write complete, production-quality documentation. Use headers, bullet points,
and code blocks where appropriate. Reference specific component names from the
architecture JSON. Do not write placeholder text.
"""


async def doc_planner_node(state: GlobalSwarmState) -> dict:
    prompt = ChatPromptTemplate.from_template(DOC_PLANNER_PROMPT)
    chain = prompt | llm_gemini
    response = await chain.ainvoke(
        {
            "architecture_json": state.get("architecture_json"),
            "component_list": state.get("component_list"),
            "complexity_score": state.get("complexity_score"),
        }
    )

    raw = response.content.strip()
    try:
        doc_plan: list[str] = json.loads(raw)
    except json.JSONDecodeError:
        doc_plan = ["overview.md"]

    if not doc_plan:
        doc_plan = ["overview.md"]

    return {"doc_plan": doc_plan}


def route_from_doc_planner(state: GlobalSwarmState) -> list[Send]:
    """Map-reduce fan-out per LangGraph Send API (conditional edge, not node return)."""
    slugs = state.get("doc_plan") or ["overview.md"]
    return [
        Send(
            "doc_generator_node",
            DocWorkerState(
                doc_slug=slug,
                task_requirement=state["task_requirement"],
                architecture_json=state["architecture_json"],
                component_list=state["component_list"],
                generated_diagrams=state.get("generated_diagrams", []),
                thread_id=state["thread_id"],
                iteration=state.get("iteration_count", 0),
                draft_content="",
            ),
        )
        for slug in slugs
    ]


async def doc_generator_node(state: DocWorkerState) -> dict:
    diagrams_summary = (
        "\n".join(
            [
                f"- {d['diagram_type']}: stored at {d['path']}"
                for d in state.get("generated_diagrams", [])
                if d["content"] != "syntax_error"
            ]
        )
        or "No diagrams available."
    )
    prompt = ChatPromptTemplate.from_template(DOC_WRITER_PROMPT)
    chain = prompt | llm_gemini
    response = await chain.ainvoke(
        {
            "doc_slug": state["doc_slug"],
            "task_requirement": state["task_requirement"],
            "architecture_json": state["architecture_json"],
            "component_list": state["component_list"],
            "diagrams_summary": diagrams_summary,
        }
    )

    content = response.content.strip()
    title = (
        state["doc_slug"].replace(".md", "").replace("-", " ").replace("_", " ").title()
    )
    path = f"reports/{state['thread_id']}/iter{state['iteration']}_{state['doc_slug']}"
    await UploadThingService().upload_file(path, content)

    entry = DocEntry(
        title=title,
        content=content,
        path=path,
    )
    return {
        "generated_docs": [entry],
    }


def _slug_from_report_path(path: str) -> str:
    """Recover doc filename from reports/{{thread_id}}/iter{{n}}_{{slug}} (thread_id may contain _)."""
    fname = path.rsplit("/", 1)[-1]
    m = re.match(r"^iter\d+_(.+)$", fname)
    return m.group(1) if m else fname


async def write_doc_node(state: GlobalSwarmState) -> dict:
    actual_slugs = [_slug_from_report_path(d["path"]) for d in state["generated_docs"]]
    return {"doc_plan": actual_slugs, "docs_complete": True}


def build_doc_generator_graph():
    graph = StateGraph(GlobalSwarmState)

    graph.add_node("doc_planner_node", doc_planner_node)
    graph.add_node("doc_generator_node", doc_generator_node)
    graph.add_node("write_doc_node", write_doc_node)

    graph.set_entry_point("doc_planner_node")

    graph.add_conditional_edges(
        "doc_planner_node",
        route_from_doc_planner,
        ["doc_generator_node"],
    )
    graph.add_edge("doc_generator_node", "write_doc_node")
    graph.add_edge("write_doc_node", END)

    return graph.compile()


doc_generator_graph = build_doc_generator_graph()

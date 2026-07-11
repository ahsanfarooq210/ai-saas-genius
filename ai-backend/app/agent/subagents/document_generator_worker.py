from app.agent.state.schema import DiagramEntry, DocEntry, DocWorkerState
from app.agent.storage.file_store import artifact_store
from app.agent.subagents.llm_reply import assistant_text
from app.core.llm import get_chat_llm

_llm = get_chat_llm()

_SYSTEM_PROMPT = """\
You are a senior technical writer producing software architecture documentation.
Write a detailed Markdown document for the requested component or concern.

Rules:
- Use proper Markdown: ## headings, bullet points, code blocks where needed
- For component docs: cover responsibilities, APIs/interfaces, data it owns,
  failure modes, and scaling considerations
- Always include a "## Related Diagrams" section at the end referencing the
  paired Mermaid diagram by its public URL when one is provided
- For overview.md: write an executive summary linking to all component docs
- Be specific — avoid generic filler text
- Output only the Markdown content, no preamble
"""


def _find_paired_diagram(
    component_slug: str,
    diagrams: list[DiagramEntry],
) -> str:
    if not component_slug:
        for d in diagrams:
            if d["diagram_type"] == "overview" and d.get("url"):
                return d.get("url") or ""
        return ""

    for d in diagrams:
        if d["component_slug"] == component_slug and d.get("url"):
            return d.get("url") or ""

    return ""


def title_from_filename(filename: str) -> str:
    name = filename.replace(".md", "")
    if name == "overview":
        return "System Overview"
    if name.startswith("adr-"):
        return f"ADR: {name[4:].replace('-', ' ').title()}"
    if name.startswith("runbook-"):
        return f"Runbook: {name[8:].replace('-', ' ').title()}"
    return f"{name.replace('-', ' ').title()} — Component Overview"


def document_generator_node(state: DocWorkerState) -> dict:
    """
    One parallel worker per doc_plan entry.
    Returns a partial GlobalSwarmState update (single DocEntry via reducer).
    """
    print(f"\n[doc_generator] generating: {state['doc_filename']}")

    paired_diagram_path = _find_paired_diagram(
        state["component_slug"],
        state["generated_diagrams"],
    )

    diagram_refs = "\n".join(
        f"- {d['diagram_type']}: {d['url']}"
        for d in state["generated_diagrams"]
        if d.get("url")
    )

    prompt = (
        f"Document to write: {state['doc_filename']}\n"
        f"Component slug: {state['component_slug'] or '(overview / cross-cutting)'}\n\n"
        f"System requirement: {state['task_requirement']}\n\n"
        "Latest revision instruction: "
        f"{state.get('revision_instruction') or '(initial generation)'}\n\n"
        f"Architecture:\n{state['architecture_json']}\n\n"
        f"Available diagrams:\n{diagram_refs or '(none)'}\n\n"
        f"Paired diagram for this document: {paired_diagram_path or 'none'}"
    )

    response = _llm.invoke(
        [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ]
    )

    content = assistant_text(response).strip()
    title = title_from_filename(state["doc_filename"])
    stored = artifact_store.upload_doc(
        thread_id=state["thread_id"],
        revision_number=state.get("revision_number", 1),
        doc_filename=state["doc_filename"],
        content=content,
    )

    return {
        "generated_docs": [
            DocEntry(
                title=title,
                component_slug=state["component_slug"],
                storage_key=stored.storage_key,
                url=stored.url,
            )
        ]
    }

"""Shared helpers for adversarial reviewer nodes."""

from __future__ import annotations

from app.agent.state.schema import DebateLogEntry, DiagramEntry, DocEntry, GlobalSwarmState

_DOC_PREVIEW_CHARS = 500


def parse_review_status(feedback: str) -> str:
    """Extract APPROVED or REJECTED from the last line; default REJECTED if missing."""
    last_line = feedback.strip().split("\n")[-1].strip()
    if "APPROVED" in last_line:
        return "APPROVED"
    if "REJECTED" in last_line:
        return "REJECTED"
    return "REJECTED"


def format_diagrams_for_review(diagrams: list[DiagramEntry] | None) -> str:
    if not diagrams:
        return "No diagrams generated."
    lines: list[str] = []
    for entry in diagrams:
        if entry["content"] == "syntax_error":
            continue
        lines.append(
            f"### {entry['diagram_type']}\n```\n{entry['content']}\n```"
        )
    return "\n\n".join(lines) if lines else "No valid diagrams generated."


def format_docs_for_review(docs: list[DocEntry] | None) -> str:
    if not docs:
        return "No docs generated."
    lines: list[str] = []
    for entry in docs:
        preview = entry["content"][:_DOC_PREVIEW_CHARS]
        suffix = "..." if len(entry["content"]) > _DOC_PREVIEW_CHARS else ""
        lines.append(f"### {entry['title']}\n{preview}{suffix}")
    return "\n\n".join(lines)


def build_review_prompt(state: GlobalSwarmState) -> str:
    return (
        f"System requirement: {state['task_requirement']}\n\n"
        f"Architecture JSON:\n{state.get('architecture_json', {})}\n\n"
        f"Generated diagrams:\n"
        f"{format_diagrams_for_review(state.get('generated_diagrams'))}\n\n"
        f"Generated docs:\n{format_docs_for_review(state.get('generated_docs'))}"
    )


def make_debate_log_entry(
    agent: str,
    feedback: str,
    status: str,
    iteration: int,
) -> DebateLogEntry:
    return {
        "agent": agent,
        "feedback": feedback,
        "status": status,
        "iteration": iteration,
    }

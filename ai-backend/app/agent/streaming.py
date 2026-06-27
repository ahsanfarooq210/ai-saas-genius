from typing import Any, Literal

StreamEventType = Literal["task_started", "task_completed", "state_update"]


_NODE_PHASES: dict[str, str] = {
    "supervisor_node": "supervisor",
    "architect_graph": "architecture",
    "prepare_architect_artifacts_node": "architecture",
    "draft_architecture_node": "architecture",
    "score_complexity_node": "architecture",
    "diagram_generator_node": "diagram",
    "reduce_diagrams_node": "diagram",
    "doc_generator_graph": "documentation",
    "prepare_doc_artifacts_node": "documentation",
    "document_generator_node": "documentation",
    "reduce_docs_node": "documentation",
    "scalability_node": "review",
    "security_node": "review",
}

_START_MESSAGES: dict[str, str] = {
    "supervisor_node": "Choosing the next graph step",
    "architect_graph": "Running architecture generation",
    "prepare_architect_artifacts_node": "Preparing architecture artifacts",
    "draft_architecture_node": "Drafting architecture",
    "score_complexity_node": "Scoring architecture complexity",
    "diagram_generator_node": "Generating diagram",
    "reduce_diagrams_node": "Collecting generated diagrams",
    "doc_generator_graph": "Running documentation generation",
    "prepare_doc_artifacts_node": "Preparing documentation artifacts",
    "document_generator_node": "Writing documentation",
    "reduce_docs_node": "Collecting generated documents",
    "scalability_node": "Reviewing scalability",
    "security_node": "Reviewing security",
}

_UPDATE_MESSAGES: dict[str, str] = {
    "supervisor_node": "Selected next graph step",
    "architect_graph": "Architecture generation completed",
    "prepare_architect_artifacts_node": "Architecture artifacts prepared",
    "draft_architecture_node": "Architecture draft ready",
    "score_complexity_node": "Architecture complexity scored",
    "diagram_generator_node": "Diagram generated",
    "reduce_diagrams_node": "Generated diagrams collected",
    "doc_generator_graph": "Documentation generation completed",
    "prepare_doc_artifacts_node": "Documentation artifacts prepared",
    "document_generator_node": "Document generated",
    "reduce_docs_node": "Generated documents collected",
    "scalability_node": "Scalability review completed",
    "security_node": "Security review completed",
}


def normalize_stream_chunk(thread_id: str, chunk: Any) -> list[dict[str, Any]]:
    """Normalize LangGraph stream chunks into the public progress event shape."""
    if not isinstance(chunk, dict):
        return []

    chunk_type = chunk.get("type")
    if chunk_type == "tasks":
        event = _normalize_task_event(thread_id, chunk)
        return [event] if event else []
    if chunk_type == "updates":
        return _normalize_update_events(thread_id, chunk)
    return []


def _normalize_task_event(thread_id: str, chunk: dict[str, Any]) -> dict[str, Any] | None:
    data = chunk.get("data")
    if not isinstance(data, dict):
        return None

    node = data.get("name")
    if not isinstance(node, str) or not node:
        return None

    is_completed = any(key in data for key in ("result", "error", "interrupts"))
    values = data.get("result") if is_completed else data.get("input")
    if not isinstance(values, dict):
        values = {}

    payload = _payload_for_node(node, values)
    if data.get("error"):
        payload["error"] = str(data["error"])

    event_type: StreamEventType = "task_completed" if is_completed else "task_started"
    return _progress_event(
        thread_id=thread_id,
        event_type=event_type,
        node=node,
        namespace=chunk.get("ns"),
        values=values,
        payload=payload,
    )


def _normalize_update_events(
    thread_id: str,
    chunk: dict[str, Any],
) -> list[dict[str, Any]]:
    data = chunk.get("data")
    if not isinstance(data, dict):
        return []

    events: list[dict[str, Any]] = []
    for node, values in data.items():
        if not isinstance(node, str) or not isinstance(values, dict):
            continue
        events.append(
            _progress_event(
                thread_id=thread_id,
                event_type="state_update",
                node=node,
                namespace=chunk.get("ns"),
                values=values,
                payload=_payload_for_node(node, values),
            )
        )
    return events


def _progress_event(
    *,
    thread_id: str,
    event_type: StreamEventType,
    node: str,
    namespace: Any,
    values: dict[str, Any],
    payload: dict[str, Any],
) -> dict[str, Any]:
    iteration_count = _iteration_count(values, payload)
    return {
        "thread_id": thread_id,
        "type": event_type,
        "node": node,
        "phase": _phase_for_node(node, namespace),
        "message": _message_for_node(node, event_type, payload),
        "iteration_count": iteration_count,
        "payload": payload,
    }


def _phase_for_node(node: str, namespace: Any) -> str:
    if node in _NODE_PHASES:
        return _NODE_PHASES[node]

    namespace_names = _namespace_names(namespace)
    if "architect_graph" in namespace_names:
        return "architecture"
    if "doc_generator_graph" in namespace_names:
        return "documentation"
    return "unknown"


def _namespace_names(namespace: Any) -> set[str]:
    if not isinstance(namespace, (tuple, list)):
        return set()
    names: set[str] = set()
    for item in namespace:
        if isinstance(item, str) and item:
            names.add(item.split(":", 1)[0])
    return names


def _message_for_node(
    node: str,
    event_type: StreamEventType,
    payload: dict[str, Any],
) -> str:
    if event_type == "task_started":
        message = _START_MESSAGES.get(node, f"Running {node}")
    else:
        message = _UPDATE_MESSAGES.get(node, f"Updated {node}")

    if node == "diagram_generator_node" and payload.get("diagram_type"):
        return f"{message}: {payload['diagram_type']}"
    if node == "document_generator_node":
        title = payload.get("title") or payload.get("doc_filename")
        if title:
            return f"{message}: {title}"
    return message


def _payload_for_node(node: str, values: dict[str, Any]) -> dict[str, Any]:
    if node == "supervisor_node":
        return _pick(values, "next_agent", "iteration_count")
    if node == "draft_architecture_node":
        return {"component_count": _component_count(values)}
    if node == "score_complexity_node":
        return {
            "complexity_score": int(values.get("complexity_score") or 0),
            "diagram_count": _safe_len(values.get("diagram_plan")),
            "doc_count": _safe_len(values.get("doc_plan")),
        }
    if node == "diagram_generator_node":
        return _diagram_payload(values)
    if node == "reduce_diagrams_node":
        return {
            "generated_diagram_count": _safe_len(values.get("generated_diagrams")),
        }
    if node == "document_generator_node":
        return _document_payload(values)
    if node == "reduce_docs_node":
        return {
            "generated_doc_count": _safe_len(values.get("generated_docs")),
            "docs_complete": bool(values.get("docs_complete")),
        }
    if node in {"scalability_node", "security_node"}:
        return {"status": _review_status(node, values)}
    if node == "architect_graph":
        return _architecture_graph_payload(values)
    if node == "doc_generator_graph":
        return _doc_graph_payload(values)
    return {}


def _pick(values: dict[str, Any], *keys: str) -> dict[str, Any]:
    return {key: values[key] for key in keys if key in values}


def _component_count(values: dict[str, Any]) -> int:
    components = values.get("component_list")
    if isinstance(components, list):
        return len(components)
    architecture = values.get("architecture_json")
    if isinstance(architecture, dict):
        return len(architecture)
    return 0


def _diagram_payload(values: dict[str, Any]) -> dict[str, Any]:
    diagram = _first_dict(values.get("generated_diagrams"))
    source = diagram or values
    payload = _pick(source, "diagram_type", "component_slug", "iteration")
    if diagram is not None:
        payload["valid"] = bool(diagram.get("storage_key") and diagram.get("url"))
    return payload


def _document_payload(values: dict[str, Any]) -> dict[str, Any]:
    doc = _first_dict(values.get("generated_docs"))
    if doc is not None:
        return _pick(doc, "title", "component_slug")
    return _pick(values, "doc_filename", "component_slug", "iteration")


def _first_dict(value: Any) -> dict[str, Any] | None:
    value = _unwrap_stream_value(value)
    if isinstance(value, list) and value and isinstance(value[0], dict):
        return value[0]
    return None


def _safe_len(value: Any) -> int:
    value = _unwrap_stream_value(value)
    try:
        return len(value)
    except TypeError:
        return 0


def _unwrap_stream_value(value: Any) -> Any:
    return getattr(value, "value", value)


def _review_status(node: str, values: dict[str, Any]) -> str:
    direct_key = (
        "scalability_feedback"
        if node == "scalability_node"
        else "security_feedback"
    )
    feedback = values.get(direct_key)
    if isinstance(feedback, str):
        return _status_from_text(feedback)

    agent = "scalability" if node == "scalability_node" else "security"
    for entry in reversed(values.get("debate_logs") or []):
        if not isinstance(entry, dict):
            continue
        if entry.get("agent") != agent:
            continue
        status = entry.get("status")
        if isinstance(status, str) and status:
            return status
    return ""


def _status_from_text(text: str) -> str:
    last_line = text.strip().split("\n")[-1].strip()
    if "APPROVED" in last_line:
        return "APPROVED"
    if "REJECTED" in last_line:
        return "REJECTED"
    return ""


def _architecture_graph_payload(values: dict[str, Any]) -> dict[str, Any]:
    payload = {
        "component_count": _component_count(values),
        "complexity_score": int(values.get("complexity_score") or 0),
        "diagram_count": _safe_len(values.get("diagram_plan")),
        "doc_count": _safe_len(values.get("doc_plan")),
        "generated_diagram_count": _safe_len(values.get("generated_diagrams")),
    }
    return {key: value for key, value in payload.items() if value}


def _doc_graph_payload(values: dict[str, Any]) -> dict[str, Any]:
    payload = {
        "generated_doc_count": _safe_len(values.get("generated_docs")),
        "docs_complete": bool(values.get("docs_complete")),
    }
    return {key: value for key, value in payload.items() if value}


def _iteration_count(values: dict[str, Any], payload: dict[str, Any]) -> int | None:
    for source in (payload, values):
        value = source.get("iteration_count") or source.get("iteration")
        if value is None:
            continue
        try:
            return int(value)
        except (TypeError, ValueError):
            continue
    return None

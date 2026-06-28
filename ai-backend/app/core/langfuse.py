"""Langfuse tracing helpers for swarm graph execution."""

from __future__ import annotations

import logging
import os
from contextlib import contextmanager, nullcontext
from typing import Any, Iterator

from app.core.config import settings

logger = logging.getLogger(__name__)

_langfuse_client: Any | None = None
_langfuse_import_error_logged = False


class SwarmTrace:
    """Small wrapper so SDK update failures never fail graph execution."""

    def __init__(self, observation: Any | None = None) -> None:
        self._observation = observation

    def set_result(self, result: dict[str, Any]) -> None:
        self._update(output=_summarize_result(result, status="done"))

    def set_done(self) -> None:
        self._update(output={"status": "done"})

    def set_cancelled(self) -> None:
        self._update(output={"status": "cancelled"})

    def set_error(self, exc: BaseException) -> None:
        self._update(
            output={
                "status": "failed",
                "error_type": type(exc).__name__,
                "message": str(exc)[:500],
            }
        )

    def _update(self, **kwargs: Any) -> None:
        if self._observation is None:
            return
        try:
            self._observation.update(**kwargs)
        except Exception:
            logger.debug("Failed to update Langfuse observation", exc_info=True)


def swarm_config_with_tracing(
    config: dict[str, Any],
    thread_id: str,
    operation: str,
) -> dict[str, Any]:
    """Add Langfuse callback metadata to LangGraph config when tracing is enabled."""
    traced_config: dict[str, Any] = dict(config)
    if not settings.langfuse_enabled():
        return traced_config

    callback = _new_callback_handler()
    if callback is None:
        return traced_config

    tags = _tags(operation)
    traced_config["callbacks"] = [callback]
    traced_config["metadata"] = _metadata(thread_id, operation)
    traced_config["tags"] = tags
    traced_config["run_name"] = operation
    return traced_config


@contextmanager
def swarm_trace(
    operation: str,
    thread_id: str,
    *,
    task_requirement: str | None = None,
) -> Iterator[SwarmTrace]:
    """Create a root Langfuse span and propagate thread metadata to child calls."""
    if not settings.langfuse_enabled():
        yield SwarmTrace()
        return

    client = _get_langfuse_client()
    propagation = _get_propagate_attributes()
    if client is None or propagation is None:
        yield SwarmTrace()
        return

    trace_name = operation.replace("_", "-")
    trace_input = _trace_input(
        thread_id,
        operation,
        task_requirement=task_requirement,
    )
    metadata = _metadata(thread_id, operation)
    tags = _tags(operation)

    try:
        observation_context = client.start_as_current_observation(
            as_type="span",
            name=trace_name,
            input=trace_input,
        )
    except TypeError:
        try:
            observation_context = client.start_as_current_observation(
                as_type="span",
                name=trace_name,
            )
        except Exception:
            logger.exception(
                "Langfuse tracing failed to start; continuing without tracing"
            )
            yield SwarmTrace()
            return
    except Exception:
        logger.exception("Langfuse tracing failed to start; continuing without tracing")
        yield SwarmTrace()
        return

    with observation_context as observation:
        trace = SwarmTrace(observation)
        trace._update(input=trace_input, metadata=metadata)
        propagation_context = _propagation_context(
            propagation,
            thread_id=thread_id,
            trace_name=trace_name,
            tags=tags,
            metadata=metadata,
        )
        with propagation_context:
            yield trace


def shutdown_langfuse() -> None:
    if _langfuse_client is None:
        return
    try:
        _langfuse_client.shutdown()
    except Exception:
        logger.debug("Failed to shut down Langfuse client", exc_info=True)


def _get_langfuse_client() -> Any | None:
    global _langfuse_client
    if _langfuse_client is not None:
        return _langfuse_client

    _configure_langfuse_env()
    try:
        from langfuse import get_client

        _langfuse_client = get_client()
        return _langfuse_client
    except Exception:
        _log_import_error_once()
        return None


def _get_propagate_attributes() -> Any | None:
    try:
        from langfuse import propagate_attributes

        return propagate_attributes
    except Exception:
        _log_import_error_once()
        return None


def _new_callback_handler() -> Any | None:
    if not settings.langfuse_enabled():
        return None
    _configure_langfuse_env()
    try:
        from langfuse.langchain import CallbackHandler

        return CallbackHandler()
    except Exception:
        _log_import_error_once()
        return None


def _configure_langfuse_env() -> None:
    _set_env_if_missing("LANGFUSE_PUBLIC_KEY", settings.LANGFUSE_PUBLIC_KEY)
    _set_env_if_missing("LANGFUSE_SECRET_KEY", settings.LANGFUSE_SECRET_KEY)
    _set_env_if_missing("LANGFUSE_BASE_URL", settings.LANGFUSE_BASE_URL)
    _set_env_if_missing("LANGFUSE_HOST", settings.LANGFUSE_BASE_URL)
    environment = settings.LANGFUSE_TRACING_ENVIRONMENT or settings.APP_ENV
    _set_env_if_missing("LANGFUSE_TRACING_ENVIRONMENT", environment)


def _set_env_if_missing(key: str, value: str | None) -> None:
    if value and not os.environ.get(key):
        os.environ[key] = value


def _propagation_context(
    propagation: Any,
    *,
    thread_id: str,
    trace_name: str,
    tags: list[str],
    metadata: dict[str, str],
) -> Any:
    try:
        return propagation(
            session_id=thread_id,
            trace_name=trace_name,
            tags=tags,
            metadata=metadata,
        )
    except TypeError:
        try:
            return propagation(
                session_id=thread_id,
                tags=tags,
                metadata=metadata,
            )
        except TypeError:
            return nullcontext()
    except Exception:
        logger.debug("Failed to create Langfuse propagation context", exc_info=True)
        return nullcontext()


def _trace_input(
    thread_id: str,
    operation: str,
    *,
    task_requirement: str | None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "thread_id": thread_id,
        "operation": operation,
    }
    if task_requirement is None:
        payload["resume"] = True
    elif settings.LANGFUSE_CAPTURE_INPUT:
        payload["task_requirement"] = task_requirement
    else:
        payload["task_requirement_length"] = len(task_requirement)
    return payload


def _summarize_result(result: dict[str, Any], *, status: str) -> dict[str, Any]:
    return {
        "status": status,
        "thread_id": result.get("thread_id") or "",
        "complexity_score": int(result.get("complexity_score") or 0),
        "component_count": len(result.get("component_list") or []),
        "diagram_count": len(result.get("generated_diagrams") or []),
        "doc_count": len(result.get("generated_docs") or []),
        "docs_complete": bool(result.get("docs_complete")),
        "iteration_count": int(result.get("iteration_count") or 0),
        "next_agent": result.get("next_agent") or "",
    }


def _metadata(thread_id: str, operation: str) -> dict[str, str]:
    return {
        "service": "ai-backend",
        "feature": "swarm",
        "operation": operation,
        "threadid": thread_id,
        "appenv": settings.APP_ENV,
        "model": settings.OPENCODE_MODEL,
        "framework": "langgraph",
    }


def _tags(operation: str) -> list[str]:
    return [
        "swarm",
        "langgraph",
        operation.replace(".", "-"),
        settings.APP_ENV,
    ]


def _log_import_error_once() -> None:
    global _langfuse_import_error_logged
    if _langfuse_import_error_logged:
        return
    _langfuse_import_error_logged = True
    logger.exception("Langfuse is enabled but the Langfuse SDK could not be loaded")

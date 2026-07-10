# Change: Langfuse tracing for swarm graph runs

**Date:** 2026-06-28

## Goal

Add optional Langfuse observability around the LangGraph swarm without changing public API contracts, graph topology, checkpoint semantics, or database persistence behavior.

## What changed

### 1. Langfuse configuration

Files: `app/core/config.py`, `.env.example`, `requirements.txt`

The app now supports credential-gated Langfuse tracing:

- `LANGFUSE_TRACING_ENABLED`
- `LANGFUSE_PUBLIC_KEY`
- `LANGFUSE_SECRET_KEY`
- `LANGFUSE_BASE_URL`
- `LANGFUSE_TRACING_ENVIRONMENT`
- `LANGFUSE_CAPTURE_INPUT`

Tracing is active only when `LANGFUSE_TRACING_ENABLED=true` and both API keys are configured. Keys alone do not activate tracing.

### 2. Tracing helper

File: `app/core/langfuse.py`

This module owns Langfuse SDK setup, root swarm spans, trace metadata/tags, LangChain callback creation, and shutdown. If the SDK is unavailable or tracing is not configured, it returns no-op tracing and preserves the existing graph config.

### 3. Swarm service instrumentation

File: `app/services/swarm_graph_service.py`

The service wraps these graph boundaries in root Langfuse spans:

- `swarm.run`
- `swarm.resume`
- `swarm.run.stream`
- `swarm.resume.stream`

Each trace uses `thread_id` as the Langfuse session id. Root span output stores a compact status/count summary instead of the full graph state. When tracing is enabled, LangGraph calls receive the Langfuse LangChain callback so nested LangChain and LLM observations can be captured automatically.

### 4. Shutdown

File: `app/main.py`

The FastAPI lifespan now calls `shutdown_langfuse()` during app shutdown so buffered traces are flushed.

## Rollback

1. Remove `langfuse` from `requirements.txt`.
2. Remove `app/core/langfuse.py`.
3. Remove Langfuse settings from `app/core/config.py` and `.env.example`.
4. Replace `swarm_config_with_tracing(...)` calls with `swarm_config(...)` in `app/services/swarm_graph_service.py`.
5. Remove the `swarm_trace(...)` wrappers from service methods.
6. Remove `shutdown_langfuse()` from `app/main.py`.

## Tests

Run the focused regression suite:

```bash
PYTHONPYCACHEPREFIX=/tmp/codex_pycache ./.venv/bin/python -m pytest -q \
  tests/test_langfuse_tracing.py \
  tests/test_swarm_graph_service_phase11.py \
  tests/test_swarm_graph_service_streaming.py
```

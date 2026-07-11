# Current project state

Live backend behavior as implemented in code. If this file disagrees with the repo, **trust the code** and update this document.

**New readers:** start with [../graphs/overview.md](../graphs/overview.md), then [../persistence/checkpointer-postgres-alembic.md](../persistence/checkpointer-postgres-alembic.md), then [../persistence/session-data-flow.md](../persistence/session-data-flow.md).

---

## What this service does

FastAPI backend for a LangGraph **architecture swarm**. A client submits a design requirement; the graph returns architecture JSON, Mermaid diagrams, Markdown docs, and optional reviewer feedback. Runs are checkpointed by `thread_id`, and later prompts can revise the latest successful architecture on that thread.

---

## Live entry points

| File | Role |
|------|------|
| `app/main.py` | App lifespan, Postgres checkpointer, service registration, Langfuse shutdown |
| `app/api/v1/router.py` | Route registration |
| `app/api/v1/endpoints/auth.py` | JWT signup/login/signin/refresh/me handlers |
| `app/api/v1/endpoints/swarm.py` | Swarm HTTP handlers |
| `app/middleware/auth.py` | JWT route middleware for protected API paths |
| `app/services/swarm_graph_service.py` | Async graph invoke/resume, streaming progress, checkpoint payload, app metadata writes, Langfuse trace boundaries |
| `app/core/langfuse.py` | Optional Langfuse SDK setup, root swarm spans, LangChain callback config |
| `app/agent/run.py` | Checkpoint payload shaping |
| `app/agent/streaming.py` | LangGraph stream event normalization and sanitization |
| `app/agent/graphs/` | Parent + subgraph topology |
| `app/agent/state/schema.py` | All state `TypedDict`s |

---

## Runtime flow

All `/api/v1/swarm/*` routes require a bearer access token issued by `/api/v1/auth/login`, `/api/v1/auth/signin`, or `/api/v1/auth/signup`. See [authentication.md](authentication.md) for request examples.

1. `POST /api/v1/swarm/run`, `revise`, or `resume` in `swarm.py`
2. `SwarmGraphService` writes a `sessions` row as `running`
3. `SwarmGraphService` invokes the compiled supervisor graph with `_empty_swarm_state`
4. Graph runs until `END` or iteration cap
5. `SwarmGraphService` updates `sessions` with the final graph-state projection and mirrors final artifacts/debate logs
6. Response validated as `SwarmRunResponse` / `SwarmCheckpointResponse`

When `LANGFUSE_TRACING_ENABLED=true` and both Langfuse API keys are present, `SwarmGraphService` wraps run/resume/stream graph calls in root Langfuse spans and passes the Langfuse LangChain callback into the LangGraph config. Keys alone do not enable tracing. Each `thread_id` is used as the Langfuse `session_id`; root span output is summarized to counts/status instead of storing the full graph state.

Streaming variants (`POST /api/v1/swarm/run/stream`, `POST /api/v1/swarm/revise/stream`, `POST /api/v1/swarm/resume/stream`) use the same graph/service path but return SSE progress events instead of the final result body. After `event: done`, clients fetch durable state/session data by `thread_id`. See [streaming.md](streaming.md).

---

## Live graph topology

The clean graph reference lives in [`../graphs/`](../graphs/):

- [overview.md](../graphs/overview.md)
- [supervisor-graph.md](../graphs/supervisor-graph.md)
- [architect-subgraph.md](../graphs/architect-subgraph.md)
- [doc-generator-subgraph.md](../graphs/doc-generator-subgraph.md)

### Parent graph (`supervisor_graph.py`)

```text
START → supervisor_node → [conditional] → architect_graph | doc_generator_graph
                                        | scalability_node | security_node | END
(each branch) → supervisor_node
```

- Cyclic supervisor with a Postgres LangGraph checkpointer in runtime
- Checkpoint-free module-level graph is kept for Mermaid topology rendering
- Routing: `app/agent/subagents/supervisor_router.py` (no LLM)
- `MAX_ITERATIONS = 5` in `supervisor_node`; pass 6 forces `END`, so pass 5 can still route pending doc regeneration

### Architect subgraph (`architect_graph.py`)

```text
START → prepare_architect_artifacts_node
     → draft_architecture_node → score_complexity_node
     → [diagram_planner: Send × N] → diagram_generator_node
     → reduce_diagrams_node → END
```

### Doc subgraph (`doc_generator_graph.py`)

```text
START → prepare_doc_artifacts_node
     → [doc_planner: Send × M] → document_generator_node
     → reduce_docs_node → END
```

---

## State model (`schema.py`)

### `GlobalSwarmState` (parent)

Important fields:

| Field | Notes |
|-------|--------|
| `task_requirement` | User prompt; set at init |
| `revision_number`, `revision_instruction`, `revision_pending` | Follow-up version, new instruction, and architect routing gate |
| `architecture_json`, `component_list` | From lead architect |
| `diagram_plan`, `doc_plan` | From complexity analyzer |
| `generated_diagrams`, `generated_docs` | **Plain lists** — replaced when subgraphs return |
| `docs_complete` | `True` after doc reduce node |
| `iteration_count`, `next_agent` | Supervisor |
| `scalability_feedback`, `security_feedback` | Reviewer Markdown + status line |
| `debate_logs` | Plain list; reviewers append via `append_debate_log` |

### Subgraph-local reducers

| State type | Reducer field |
|------------|----------------|
| `ArchitectGraphState` | `generated_diagrams` → `operator.add` |
| `DocGraphState` | `generated_docs` → `operator.add` |

Do **not** put `operator.add` on artifact fields in `GlobalSwarmState`. See [state-merge-and-artifacts.md](../flows/state-merge-and-artifacts.md) and [../graphs/overview.md](../graphs/overview.md).

### Artifact reset

`app/agent/subagents/artifact_reset.py` — clears artifacts at subgraph `START` before regeneration.

---

## Live API

| Method | Path |
|--------|------|
| `POST` | `/api/v1/auth/signup` |
| `POST` | `/api/v1/auth/login` |
| `POST` | `/api/v1/auth/signin` |
| `POST` | `/api/v1/auth/refresh` |
| `GET` | `/api/v1/auth/me` |
| `POST` | `/api/v1/swarm/run` |
| `POST` | `/api/v1/swarm/run/stream` |
| `POST` | `/api/v1/swarm/revise` |
| `POST` | `/api/v1/swarm/revise/stream` |
| `POST` | `/api/v1/swarm/resume` |
| `POST` | `/api/v1/swarm/resume/stream` |
| `GET` | `/api/v1/swarm/state/{thread_id}` |
| `GET` | `/api/v1/swarm/sessions/{thread_id}` |
| `GET` | `/api/v1/swarm/sessions/{thread_id}/revisions` |
| `GET` | `/api/v1/swarm/sessions/{thread_id}/revisions/{revision_number}` |
| `GET` | `/api/v1/swarm/graphs` |
| `GET` | `/api/v1/swarm/graphs/{graph_id}/mermaid` |
| `GET` | `/health` |

Graph introspection is backed by [`app/agent/graph_mermaid.py`](../../app/agent/graph_mermaid.py) (`supervisor`, `architect`, `doc_generator`).

`/api/v1/auth/*` endpoints are public except `/api/v1/auth/me`, which uses the same access-token dependency as protected routes. The JWT middleware protects non-auth `/api/v1/*` paths and supports `Authorization: Bearer <token>` plus the existing `accessToken` cookie fallback.

For login, signup, refresh, and authenticated request examples, see [authentication.md](authentication.md).

`/api/v1/swarm/sessions/{thread_id}` is the app-table result view. It returns the `sessions` row plus persisted final graph fields (`architecture_json`, `component_list`, Mermaid summary, plans, reviewer feedback, supervisor state), final artifact rows, and mirrored debate logs. `/api/v1/swarm/state/{thread_id}` remains the checkpoint-backed state view.

For the full persistence flow, see [../persistence/session-data-flow.md](../persistence/session-data-flow.md).
For follow-up request examples and version semantics, see [iterative-revisions.md](iterative-revisions.md).

---

## Artifacts

| Type | State fields | Persistent store |
|------|--------------|------------------|
| Diagrams | `DiagramEntry`: `diagram_type`, `component_slug`, `storage_key`, `url`, `iteration` | Cloudinary via [`artifact_store.upload_diagram`](../../app/agent/storage/file_store.py) |
| Docs | `DocEntry`: `title`, `component_slug`, `storage_key`, `url` | Cloudinary via [`artifact_store.upload_doc`](../../app/agent/storage/file_store.py) |

Configured at startup from `CLOUDINARY_*` settings in [`app/main.py`](../../app/main.py).

## Observability

Langfuse tracing is optional and explicitly enabled:

| Setting | Purpose |
|---------|---------|
| `LANGFUSE_TRACING_ENABLED` | Enables/disables tracing when credentials exist |
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` | Langfuse project API keys |
| `LANGFUSE_BASE_URL` | Langfuse Cloud or self-hosted endpoint |
| `LANGFUSE_TRACING_ENVIRONMENT` | Environment tag sent to Langfuse; defaults to `APP_ENV` |
| `LANGFUSE_CAPTURE_INPUT` | Controls whether root spans include the submitted task requirement |

LLM prompts, model names, token usage, and nested graph observations are captured through the Langfuse LangChain callback when tracing is enabled.

---

## Wired vs not wired

**Wired:**

- Supervisor loop with architect, docs, scalability, security
- Parallel diagram and doc generation via `Send`
- LLM reviewers with `REJECTED` → architect rerun
- Subgraph artifact reset and parent plain-list merge (2026-05-30)
- SSE progress streaming for run/resume with sanitized graph events
- Iterative follow-up revisions with latest-successful promotion and history
- Session-table final graph-state projection for durable result reads
- JWT signup/login/signin/refresh/me endpoints and protected `/api/v1/swarm/*` routes
- Optional Langfuse tracing for swarm run/resume/stream operations

**On disk but not in active graph:**

- `deep_dive.py`, `summarize.py`
- `app/agent/router/supervisor_router.py` (rehearsal router only)

**Roadmap / not production-complete:**

- Human-feedback interrupts

---

## Layer boundaries

| Layer | Should contain |
|-------|----------------|
| API | Validation, async service calls, response models |
| Service | Async graph calls, streaming graph calls, empty state, checkpoint payload, app metadata writes |
| `graphs/` | Topology only |
| `subagents/` | Prompts, node logic, structured output |
| `state/schema.py` | TypedDict contracts |

---

## Tests worth running after graph changes

```bash
pytest tests/test_subgraph_artifact_accumulation.py \
       tests/test_reducer_phase6.py \
       tests/test_reducer_phase8.py \
       tests/test_supervisor_routing_phase9.py \
       tests/test_swarm_streaming_events.py \
       tests/test_swarm_graph_service_streaming.py -q
```

---

## How to update this file

Update when routes, graph edges, state fields, or merge semantics change. Link to [changes/](../changes/) for behavioral changelogs.

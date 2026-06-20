# Current project state

Live backend behavior as implemented in code. If this file disagrees with the repo, **trust the code** and update this document.

**New readers:** start with [how-the-swarm-graph-works.md](how-the-swarm-graph-works.md), then [state-merge-and-artifacts.md](../flows/state-merge-and-artifacts.md).

---

## What this service does

FastAPI backend for a LangGraph **architecture swarm**. A client submits a design requirement; the graph returns architecture JSON, Mermaid diagrams, Markdown docs, and optional reviewer feedback. Runs are checkpointed by `thread_id`.

---

## Live entry points

| File | Role |
|------|------|
| `app/main.py` | App lifespan, Postgres checkpointer, service registration |
| `app/api/v1/router.py` | Route registration |
| `app/api/v1/endpoints/swarm.py` | Swarm HTTP handlers |
| `app/services/swarm_graph_service.py` | Async graph invoke/resume, checkpoint payload, app metadata writes |
| `app/agent/run.py` | Checkpoint payload shaping |
| `app/agent/graphs/` | Parent + subgraph topology |
| `app/agent/state/schema.py` | All state `TypedDict`s |

---

## Runtime flow

1. `POST /api/v1/swarm/run` or `resume` in `swarm.py`
2. `SwarmGraphService` writes a `sessions` row as `running`
3. `SwarmGraphService` invokes the compiled supervisor graph with `_empty_swarm_state`
4. Graph runs until `END` or iteration cap
5. `SwarmGraphService` updates `sessions` and mirrors final `debate_logs`
6. Response validated as `SwarmRunResponse` / `SwarmCheckpointResponse`

---

## Live graph topology

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

Do **not** put `operator.add` on artifact fields in `GlobalSwarmState`. See [state-merge-and-artifacts.md](../flows/state-merge-and-artifacts.md).

### Artifact reset

`app/agent/subagents/artifact_reset.py` — clears artifacts at subgraph `START` before regeneration.

---

## Live API

| Method | Path |
|--------|------|
| `POST` | `/api/v1/swarm/run` |
| `POST` | `/api/v1/swarm/resume` |
| `GET` | `/api/v1/swarm/state/{thread_id}` |
| `GET` | `/health` |

Graph introspection routes are also registered under `/api/v1/swarm/graphs`.

---

## Artifacts

| Type | State | Disk |
|------|-------|------|
| Diagrams | `DiagramEntry` in `generated_diagrams` | `FileStore.save_diagram` exists; workers do not call it yet |
| Docs | `DocEntry` in `generated_docs` | `output/reports/{thread_id}/*.md` |

---

## Wired vs not wired

**Wired:**

- Supervisor loop with architect, docs, scalability, security
- Parallel diagram and doc generation via `Send`
- LLM reviewers with `REJECTED` → architect rerun
- Subgraph artifact reset and parent plain-list merge (2026-05-30)

**On disk but not in active graph:**

- `deep_dive.py`, `summarize.py`
- `app/agent/router/supervisor_router.py` (rehearsal router only)

**Roadmap / not production-complete:**

- Diagram files on disk from workers
- Full auth API (README may mention scaffolded auth not wired in router)
- Phase 12 SSE streaming and human-feedback interrupts

---

## Layer boundaries

| Layer | Should contain |
|-------|----------------|
| API | Validation, async service calls, response models |
| Service | Async graph calls, empty state, checkpoint payload, app metadata writes |
| `graphs/` | Topology only |
| `subagents/` | Prompts, node logic, structured output |
| `state/schema.py` | TypedDict contracts |

---

## Tests worth running after graph changes

```bash
pytest tests/test_subgraph_artifact_accumulation.py \
       tests/test_reducer_phase6.py \
       tests/test_reducer_phase8.py \
       tests/test_supervisor_routing_phase9.py -q
```

---

## How to update this file

Update when routes, graph edges, state fields, or merge semantics change. Link to [changes/](../changes/) for behavioral changelogs.

# How the swarm graph works

**Audience:** Developers and agents reading the codebase for the first time.

**Live code wins:** If anything here disagrees with Python under `app/agent/`, trust the code and update this doc.

**Newer clean graph reference:** Start with [`../graphs/overview.md`](../graphs/overview.md), then read [`../graphs/supervisor-graph.md`](../graphs/supervisor-graph.md), [`../graphs/architect-subgraph.md`](../graphs/architect-subgraph.md), and [`../graphs/doc-generator-subgraph.md`](../graphs/doc-generator-subgraph.md). This file remains as a broader historical end-to-end explanation.

**Prerequisites:** Basic LangGraph concepts (nodes, edges, state, checkpoints). For merge semantics (reducers vs replace), read [state-merge-and-artifacts.md](../flows/state-merge-and-artifacts.md) next.

---

## 1. What this system does

A client sends a **system design requirement** (natural language). The backend runs a **LangGraph swarm** and returns structured state:

- `architecture_json` and `component_list`
- Many **Mermaid diagrams** (`generated_diagrams`)
- Many **Markdown documents** (`generated_docs`) persisted to Cloudinary with public URLs in state
- Optional **reviewer feedback** and `debate_logs` when scalability/security nodes run

The same `thread_id` can **resume** an interrupted checkpoint or **revise** the latest successful architecture with a new instruction.

---

## 2. Layers from HTTP to LLM

```mermaid
flowchart TB
  subgraph api [API layer]
    EP["POST /api/v1/swarm/run"]
    STREAM["POST /api/v1/swarm/run/stream"]
    SVC[SwarmGraphService]
  end
  subgraph parent [Parent graph - GlobalSwarmState]
    SUP[supervisor_node]
    ROUTE{conditional route}
    ARCH[architect_graph]
    DOC[doc_generator_graph]
    SCALE[scalability_node]
    SEC[security_node]
  end
  EP --> SVC
  STREAM --> SVC
  SVC --> SUP
  SUP --> ROUTE
  ROUTE --> ARCH
  ROUTE --> DOC
  ROUTE --> SCALE
  ROUTE --> SEC
  ARCH --> SUP
  DOC --> SUP
  SCALE --> SUP
  SEC --> SUP
```

| Layer | Responsibility | Key files |
|-------|----------------|-----------|
| API | Validate request, pass DB session, await async service calls | `app/api/v1/endpoints/swarm.py` |
| Service | Empty initial state, async graph calls, app metadata writes | `app/services/swarm_graph_service.py` |
| Streaming | Normalize LangGraph stream chunks into sanitized progress events | `app/agent/streaming.py`, `docs/current/streaming.md` |
| Parent graph | Route between phases; runtime graph receives Postgres checkpointer | `app/agent/graphs/supervisor_graph.py` |
| Subgraphs | Architect (draft + diagrams) and docs (Markdown) | `architect_graph.py`, `doc_generator_graph.py` |
| Subagents | Prompts, structured output, node bodies | `app/agent/subagents/` |
| State types | `GlobalSwarmState`, subgraph states, worker states | `app/agent/state/schema.py` |

---

## 3. Three compiled graphs, three state types

| Graph | State type | Role |
|-------|------------|------|
| `supervisor_graph` | `GlobalSwarmState` | Orchestration loop, reviewers, checkpoint owner |
| `architect_graph` | `ArchitectGraphState` | Draft architecture, plan diagrams, parallel generation |
| `doc_generator_graph` | `DocGraphState` | Parallel Markdown from `doc_plan` |

The parent mounts compiled subgraphs with `add_node("architect_graph", architect_graph)`. Subgraph outputs merge into `GlobalSwarmState` using **plain list replace** for artifacts (see [state-merge-and-artifacts.md](../flows/state-merge-and-artifacts.md)).

---

## 4. Parent graph: supervisor loop

**File:** [`supervisor_graph.py`](../../app/agent/graphs/supervisor_graph.py)

```text
START → supervisor_node → [conditional] → architect_graph | doc_generator_graph
                                        | scalability_node | security_node | END
(each branch) → supervisor_node
```

**Routing** is deterministic (no LLM) in [`supervisor_router.py`](../../app/agent/subagents/supervisor_router.py):

| Order | Condition | Next node |
|-------|-----------|-----------|
| 1 | `revision_pending` is true | `architect_graph` |
| 2 | `component_list` empty | `architect_graph` |
| 3 | `docs_complete` is false | `doc_generator_graph` |
| 4 | `scalability_feedback` contains `REJECTED` | `architect_graph` |
| 5 | `scalability_feedback` empty | `scalability_node` |
| 6 | `security_feedback` contains `REJECTED` | `architect_graph` |
| 7 | `security_feedback` empty | `security_node` |
| 8 | else | `END` |

**Iteration cap:** `supervisor_node` increments `iteration_count` each lap. The **fifth** supervisor pass still routes normally; the circuit breaker forces `END` only once `iteration_count > 5` (`MAX_ITERATIONS`). This lets a rejection-driven architect rerun reach the doc phase instead of ending with cleared docs.

**Checkpointer:** runtime graph uses LangGraph Postgres checkpointing from [`app/db/checkpointer.py`](../../app/db/checkpointer.py). Config: `{"configurable": {"thread_id": "<id>"}}` via [`swarm_config()`](../../app/agent/run.py). See [phase-11-postgres-persistence.md](phase-11-postgres-persistence.md) for the full implementation details.

---

## 5. Architect subgraph (diagrams)

**File:** [`architect_graph.py`](../../app/agent/graphs/architect_graph.py)

```text
START → prepare_architect_artifacts_node
     → draft_architecture_node
     → score_complexity_node
     → [diagram_planner_node: Send × N]
     → diagram_generator_node (parallel)
     → reduce_diagrams_node
     → END
```

### Step-by-step

1. **`prepare_architect_artifacts_node`** ([`artifact_reset.py`](../../app/agent/subagents/artifact_reset.py))  
   Clears `generated_diagrams`, `generated_docs`, sets `docs_complete=False` so each architect pass starts clean.

2. **`draft_architecture_node`** ([`lead_architect.py`](../../app/agent/subagents/lead_architect.py))  
   LLM structured output → `architecture_json`, `component_list`, `current_architecture_mermaid`.  
   For a user revision, receives the original requirement, complete current architecture, and new instruction; unaffected decisions must be preserved. For reviewer reruns, it also injects rejection feedback.

3. **`score_complexity_node`** ([`comlexity_analyzer.py`](../../app/agent/subagents/comlexity_analyzer.py))  
   Sets `complexity_score`, `diagram_plan`, `doc_plan` (used later by doc subgraph).

4. **`diagram_planner_node`** (conditional edge, not `add_node`)  
   Returns `list[Send]` — one isolated [`DiagramWorkerState`](../../app/agent/state/schema.py) per `diagram_plan` entry.

5. **`diagram_generator_node`** ([`diagram_generator_worker.py`](../../app/agent/subagents/diagram_generator_worker.py))  
   LLM Mermaid + [`mermaid_linter`](../../app/agent/tools/mermaid_linter.py) retry loop (up to 3 attempts). On success, uploads via [`artifact_store.upload_diagram`](../../app/agent/storage/file_store.py). Returns one `DiagramEntry` per worker; **subgraph reducer appends**.

6. **`reduce_diagrams_node`** ([`reduce_diagrams.py`](../../app/agent/subagents/reduce_diagrams.py))  
   Drops entries with empty `storage_key` or `url`; `Overwrite(valid_diagrams)` inside subgraph.

When the subgraph returns to the parent, `generated_diagrams` **replaces** the parent field (no duplicate append).

---

## 6. Doc subgraph (Markdown)

**File:** [`doc_generator_graph.py`](../../app/agent/graphs/doc_generator_graph.py)

```text
START → prepare_doc_artifacts_node
     → [doc_planner_node: Send × M]
     → document_generator_node (parallel)
     → reduce_docs_node
     → END
```

### Step-by-step

1. **`prepare_doc_artifacts_node`** — clears `generated_docs`, `docs_complete=False`.

2. **`doc_planner_node`** — `Send` per `doc_plan` filename with [`DocWorkerState`](../../app/agent/state/schema.py), including a snapshot of `generated_diagrams` for pairing.

3. **`document_generator_node`** — LLM Markdown; [`artifact_store.upload_doc`](../../app/agent/storage/file_store.py) → Cloudinary raw asset with `storage_key` + `url` on `DocEntry`.

4. **`reduce_docs_node`** — `Overwrite(all_docs)`, `docs_complete=True`.

Docs **read** diagrams from parent state; they do not regenerate diagrams. Parent merge must not re-append diagram lists when the doc subgraph returns (see merge doc).

---

## 7. Reviewers (parent nodes, not subgraphs)

| Node | File | Writes |
|------|------|--------|
| `scalability_node` | `scalability_expert.py` | `scalability_feedback`, `debate_logs` |
| `security_node` | `security_auditor.py` | `security_feedback`, `debate_logs` |

Both call `get_chat_llm()` with adversarial prompts. Response must end with `STATUS: APPROVED` or `STATUS: REJECTED`.

`debate_logs` is built with [`append_debate_log()`](../../app/agent/subagents/reviewer_common.py) (full list returned; parent replaces the field).

`REJECTED` → supervisor sends flow back to **`architect_graph`** → prepare clears stale artifacts → docs run again when `docs_complete` is false.

---

## 8. Typical happy path

```mermaid
sequenceDiagram
  participant C as Client
  participant P as supervisor_graph
  participant A as architect_graph
  participant D as doc_generator_graph
  participant R as scalability_node

  C->>P: POST /swarm/run
  P->>P: supervisor → architect
  P->>A: invoke subgraph
  A-->>P: architecture + diagrams
  P->>P: supervisor → docs
  P->>D: invoke subgraph
  D-->>P: generated_docs, docs_complete
  P->>P: supervisor → scalability
  P->>R: review
  R-->>P: APPROVED + debate_log
  P->>P: supervisor → security → END
  P-->>C: SwarmRunResponse
```

The streaming variant uses the same graph path but different transport:

```text
POST /api/v1/swarm/run/stream → SSE progress events → event: done
GET  /api/v1/swarm/state/{thread_id} or /sessions/{thread_id} → durable graph state and result metadata
```

Streaming does not change graph topology. `SwarmGraphService` calls LangGraph `astream(..., stream_mode=["tasks", "updates"], subgraphs=True, version="v2")`, and `app/agent/streaming.py` sanitizes raw chunks before the API sends SSE frames. See [streaming.md](streaming.md).

---

## 9. Artifacts in state vs Cloudinary

| Artifact | In state (`DiagramEntry` / `DocEntry`) | Persistent store |
|----------|----------------------------------------|------------------|
| Diagrams | `diagram_type`, `component_slug`, `storage_key`, `url`, `iteration` | [`artifact_store.upload_diagram`](../../app/agent/storage/file_store.py) → Cloudinary raw `.mmd` |
| Docs | `title`, `component_slug`, `storage_key`, `url` | [`artifact_store.upload_doc`](../../app/agent/storage/file_store.py) → Cloudinary raw `.md` |

Cloudinary keys embed both `thread_id` and `revision_number` (e.g. `{folder}/{thread_id}/revisions/{revision}/diagrams/iter{n}_{type}.mmd`) so historical versions do not overwrite one another. Mermaid source and Markdown body are **not** duplicated in checkpoint state — agents and the API use `url` for delivery.

---

## 10. Pairing diagrams and docs

Both plans come from the complexity analyzer. Live pairing behavior is:

- Diagram plan entries like `component-api-gateway` produce diagram `component_slug="api-gateway"` via [`_slug_from_entry`](../../app/agent/subagents/diagram_planner.py)
- Doc filenames like `component-api-gateway.md` produce doc `component_slug="component-api-gateway"` via [`slug_from_doc_filename`](../../app/agent/subagents/doc_planner.py)
- `overview.md` maps to `component_slug=""` and pairs with the `overview` diagram
- `adr-*.md` and `runbook-*.md` also map to `component_slug=""` and are treated as cross-cutting docs

Doc workers look for a paired diagram with [`_find_paired_diagram`](../../app/agent/subagents/document_generator_worker.py) and add a **Related Diagrams** section when a `url` exists.

**Current limitation:** component docs do not currently pair to component diagrams by exact `component_slug`, because the doc path keeps the `component-` prefix while the diagram path strips it. Overview pairing works; component pairing needs slug normalization code, not just doc changes.

---

## 11. API surface

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/v1/swarm/run` | New run with `task_requirement` + `thread_id` |
| `POST` | `/api/v1/swarm/run/stream` | New run with SSE progress events |
| `POST` | `/api/v1/swarm/revise` | Apply an instruction to the latest successful architecture |
| `POST` | `/api/v1/swarm/revise/stream` | Apply a revision with SSE progress events |
| `POST` | `/api/v1/swarm/resume` | Continue checkpointed thread |
| `POST` | `/api/v1/swarm/resume/stream` | Continue checkpointed thread with SSE progress events |
| `GET` | `/api/v1/swarm/state/{thread_id}` | Checkpoint summary |
| `GET` | `/api/v1/swarm/sessions` | Newest-first session summaries owned by the authenticated user |
| `GET` | `/api/v1/swarm/sessions/{thread_id}` | App `sessions` row + persisted graph-state projection, artifacts, and debate logs |
| `GET` | `/api/v1/swarm/sessions/{thread_id}/revisions` | Revision history metadata |
| `GET` | `/api/v1/swarm/sessions/{thread_id}/revisions/{revision_number}` | Stored result for one revision |
| `GET` | `/api/v1/swarm/graphs` | List compiled graph ids (`supervisor`, `architect`, `doc_generator`) |
| `GET` | `/api/v1/swarm/graphs/{graph_id}/mermaid` | Mermaid topology from [`graph_mermaid.py`](../../app/agent/graph_mermaid.py) |
| `GET` | `/health` | Health check |

Response shaping: [`app/schemas/swarm.py`](../../app/schemas/swarm.py), [`build_checkpoint_payload`](../../app/agent/run.py).

---

## 12. Code map (quick reference)

| Question | Where to look |
|----------|----------------|
| Parent wiring | `app/agent/graphs/supervisor_graph.py` |
| Architect wiring | `app/agent/graphs/architect_graph.py` |
| Doc wiring | `app/agent/graphs/doc_generator_graph.py` |
| Routing rules | `app/agent/subagents/supervisor_router.py` |
| State fields | `app/agent/state/schema.py` |
| Reset on rerun | `app/agent/subagents/artifact_reset.py` |
| Initial empty state | `app/services/swarm_graph_service.py` → `_empty_swarm_state` |
| LLM client | `app/core/llm.py` → `get_chat_llm()` |

---

## 13. Not wired (files exist, graph does not call them)

- `deep_dive.py`, `summarize.py`
- `app/agent/router/supervisor_router.py` (`route_after_complexity` rehearsal only)

See [project-state.md](project-state.md) for an up-to-date gap list.

---

## 14. Further reading

| Doc | Topic |
|-----|--------|
| [state-merge-and-artifacts.md](../flows/state-merge-and-artifacts.md) | Reducers, duplicates, resets |
| [swarm-graph-overview.md](../flows/swarm-graph-overview.md) | Full topology tables, dependency diagram |
| [phase-7-flow.md](../flows/phase-7-flow.md) | Diagram `Send`, lint loop |
| [`../flows/phase-8-flow.md`](../flows/phase-8-flow.md) | Doc `Send`, Cloudinary artifacts |
| [architecture/plan.md](../architecture/plan.md) | Target design (roadmap) |

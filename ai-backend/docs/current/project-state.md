# Current Project State

This document explains the live backend as it exists in code today. It is meant to be readable by both humans and AI agents.

If this file and the code ever disagree, trust the code and update this document.

## What This Service Does

This repository is a FastAPI backend for a LangGraph-based architecture swarm. A client submits a system-design requirement, the backend runs a graph, and the API returns the resulting swarm state.

Today, the implementation is still an early-phase swarm. It already has:

- FastAPI app wiring
- a compile-once graph service
- checkpointed graph invocation by `thread_id`
- architecture drafting
- complexity analysis
- parallel diagram generation via LangGraph `Send` (Phases 6–7)
- parallel document generation via LangGraph `Send` (Phase 8)
- reducer-backed `generated_diagrams` and `generated_docs` collections
- Mermaid lint-and-retry in diagram workers
- Markdown docs written to `output/reports/{thread_id}/` via `FileStore`

It does not yet have the full supervisor loop or reviewer loop wired into the live graph. See [swarm-graph-overview.md](../flows/swarm-graph-overview.md), [phase-6-flow.md](../flows/phase-6-flow.md), [phase-7-flow.md](../flows/phase-7-flow.md), and [phase-8-flow.md](../flows/phase-8-flow.md).

## Live Entry Points

Inspect these files first when you need the current truth:

- `app/main.py`
- `app/api/v1/router.py`
- `app/api/v1/endpoints/swarm.py`
- `app/services/swarm_graph_service.py`
- `app/agent/run.py`
- `app/agent/graphs/`
- `app/agent/state/schema.py`

## Runtime Flow

The current request flow is:

1. FastAPI receives a request in `app/api/v1/endpoints/swarm.py`
2. The route resolves `SwarmGraphService` from `app.state`
3. The route offloads sync graph execution with `asyncio.to_thread(...)`
4. `SwarmGraphService` invokes the compiled LangGraph using `thread_id`
5. The graph returns a state dict
6. The API validates that dict through `SwarmRunResponse` or `SwarmCheckpointResponse`

## Live Graph Topology

The live graph is simpler than the target architecture plan.

### Parent graph

`app/agent/graphs/supervisor_graph.py`

```text
START -> supervisor_node -> [conditional] -> architect_graph | doc_generator_graph
                                        | scalability_node | security_node | END
architect_graph      -> supervisor_node
doc_generator_graph  -> supervisor_node
scalability_node     -> supervisor_node
security_node        -> supervisor_node
```

The parent graph is cyclic: `supervisor_node` routes via `app/agent/subagents/supervisor_router.py` (no LLM). Stub reviewers always approve until Phase 10. The parent owns the `MemorySaver` checkpointer.

### Architect subgraph

`app/agent/graphs/architect_graph.py`

```text
START -> draft_architecture_node -> score_complexity_node
     -> [diagram_planner: Send × N] -> diagram_generator_node (parallel)
     -> reduce_diagrams_node -> END
```

The architect subgraph currently performs:

- `LeadArchitect.draft_architecture_node`
- `ComplexityAnalyzer.score_complexity_node`
- `diagram_planner_node` (conditional edge; returns `list[Send]`, not an `add_node`)
- `DiagramGenerator.diagram_generator_node` (one invocation per plan entry)
- `reduce_diagrams_node` (drops `syntax_error` entries; `Overwrite` on `generated_diagrams`)

### Doc generator subgraph

`app/agent/graphs/doc_generator_graph.py`

```text
START -> [doc_planner: Send × M] -> document_generator_node (parallel)
     -> reduce_docs_node -> END
```

The doc subgraph:

- `doc_planner_node` (conditional edge from `START`; returns `list[Send]`)
- `document_generator_node` (one invocation per `doc_plan` entry; reads `generated_diagrams` for pairing)
- `reduce_docs_node` (sets `docs_complete: True`)

## Current State Model

Shared graph state lives in `app/agent/state/schema.py` as `TypedDict` definitions.

### GlobalSwarmState

Important live fields:

- `task_requirement`: original user request
- `architecture_draft`: reserved legacy field, currently initialized but not meaningfully populated
- `architecture_json`: structured architecture output
- `component_list`: normalized component names
- `current_architecture_mermaid`: overview Mermaid diagram
- `complexity_score`: complexity rating from the analyzer
- `diagram_plan`: planned diagram identifiers
- `doc_plan`: planned document identifiers (consumed by doc sub-graph)
- `deep_dive_notes`: reserved for future deep-dive flow
- `thread_id`: checkpoint thread; used in artifact paths
- `generated_diagrams`: reducer-backed list for diagram worker results
- `generated_docs`: reducer-backed list for document worker results
- `docs_complete`: `True` after doc sub-graph finishes
- `iteration_count`: supervisor lap counter (cap 5)
- `next_agent`: last routing decision written by supervisor
- `scalability_feedback`: full Markdown scalability critique ending with `STATUS: APPROVED` or `STATUS: REJECTED`
- `security_feedback`: full Markdown security critique ending with `STATUS: APPROVED` or `STATUS: REJECTED`
- `debate_logs`: in-memory audit trail (`DebateLogEntry` per reviewer pass)

### Reducer-backed fields

`generated_diagrams`, `generated_docs`, and `debate_logs` are annotated with `operator.add`. Parallel LangGraph workers must merge results instead of overwriting each other; reduce nodes use `Overwrite` where a full list replacement is required. See [phase-6-flow.md](../flows/phase-6-flow.md).

## Current API Surface

The live API router currently exposes:

- `POST /api/v1/swarm/run`
- `POST /api/v1/swarm/resume`
- `GET /api/v1/swarm/state/{thread_id}`
- `GET /health`

These are described here because they are part of the current live system. If routes change, update this file with the same commit.

## What Exists On Disk But Is Not Wired

Examples of modules not in the active graph:

- deep dive node
- summarize node
- `route_after_complexity` in `app/agent/router/supervisor_router.py` (rehearsal only)

Do not assume a module is active just because the file exists.

## Current Architectural Boundaries

### API layer

The API layer should stay thin:

- request validation
- dependency resolution
- thread offloading
- response validation

### Service layer

`SwarmGraphService` owns:

- graph compilation lifetime
- run and resume entry points
- checkpoint lookup
- initial empty state creation

### Graph layer

Graph files in `app/agent/graphs/` should contain topology and wiring, not prompts.

### Subagent layer

Files in `app/agent/subagents/` should contain:

- prompts
- structured output handling
- node implementation logic
- output normalization

## Known Gaps

The most important current gaps are:

- `debate_logs` are in-memory only (Phase 11 persists to Postgres)
- diagram paths are logical keys only (no file store writes yet)
- some legacy scaffolded auth references still exist in README-level documentation

## How To Update This Document

Update this file when any of these change:

- active routes
- graph topology
- shared state fields
- which modules are wired versus only present on disk

Keep the writing direct. Prefer short sections and concrete file references over long narrative text.

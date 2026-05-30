# Critical Change: Diagram Generation Foundation

Date: 2026-05-28

> **Update:** The architect graph now wires planner, workers, and reduce. See [phase-7-flow.md](../flows/phase-7-flow.md) and [state-merge-and-artifacts.md](../flows/state-merge-and-artifacts.md). Reducers now live on `ArchitectGraphState`, not parent `GlobalSwarmState` — see [2026-05-30-subgraph-artifact-merge-fix.md](2026-05-30-subgraph-artifact-merge-fix.md). Sections below that say “not fully active in the runtime graph” are historical.

## Why This Change Matters

The codebase now contains the first real foundation for parallel diagram generation. This is important because the long-term swarm architecture depends on generating a variable number of artifacts from runtime planning, not from a fixed graph shape.

This change does not fully wire diagram generation into the active graph yet, but it introduces the state model and worker logic needed for that next step.

## What Changed

### 1. `GlobalSwarmState` gained reducer-backed diagram storage

File: `app/agent/state/schema.py`

Added:

- `generated_diagrams: Annotated[list[DiagramEntry], operator.add]`
- `DiagramEntry`
- `DiagramWorkerState`

Why it matters:

- parallel LangGraph workers must append results safely
- plain `list[...]` fields would be overwritten by later workers
- the reducer test documents and verifies this behavior

## 2. Diagram fan-out planner was added

File: `app/agent/subagents/diagram_planner.py`

What it does:

- reads `diagram_plan`
- creates one `Send(...)` per planned diagram
- builds isolated `DiagramWorkerState` payloads per worker
- derives `component_slug` for component-scoped diagrams

Why it matters:

- the number of diagram workers is only known at runtime
- this is the core LangGraph fan-out pattern the project needs

## 3. Diagram worker generation logic was added

File: `app/agent/subagents/diagram_generator_worker.py`

What it does:

- invokes the shared chat model
- asks for one Mermaid diagram for one diagram type
- strips code fences
- validates syntax through the Mermaid linter
- retries up to three times
- returns one reducer-compatible `generated_diagrams` update

Why it matters:

- it defines the single-worker contract for future parallel execution
- it keeps validation close to generation instead of trusting raw LLM output

## 4. Mermaid linting tool was added

File: `app/agent/tools/mermaid_linter.py`

What it currently checks:

- valid Mermaid opening declaration
- balanced brackets
- no empty node labels

Why it matters:

- it provides a fast local correctness gate
- it gives the worker a concrete repair signal

Limits:

- this is still a lightweight validator, not a full Mermaid parser

## What Did Not Change Yet

These additions are important, but they are not fully active in the runtime graph yet.

Still missing from live graph wiring:

- `diagram_planner_node` inside `architect_graph`
- `diagram_generator_node` registration in the graph
- reduce stage in the active graph
- any API response fields that expose generated diagrams

In other words, the repo now has the diagram-generation building blocks, but the runtime graph still stops after complexity scoring.

## Impact On Future Work

The next graph-wiring step should be:

1. register the planner and worker nodes in `architect_graph.py`
2. confirm `generated_diagrams` is initialized where required
3. update response schemas if diagram output should be returned
4. add tests for fan-out and reducer merge behavior beyond the current reducer-only test

## Risks And Watchouts

- `SwarmGraphService._empty_swarm_state(...)` does not currently initialize `generated_diagrams`
- `SwarmRunResponse` does not currently expose `generated_diagrams`
- `diagram_planner_node` reads fields like `thread_id` and `iteration_count` through `state.get(...)`, but those are not part of `GlobalSwarmState`
- the active graph still does not use these nodes, so behavior can drift if the docs are not kept in sync once wiring happens

## Bottom Line

This change is a foundation change, not a finished feature.

It introduced the contracts needed for:

- runtime fan-out
- reducer-safe artifact collection
- per-diagram worker generation
- local Mermaid validation

The next critical milestone is wiring these pieces into the active graph and returning the results through the API.

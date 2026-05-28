# Phase 6: Reducers (`Annotated[list, operator.add]`)

Implementation reference for [Phase 6](../learning/langchain-langgraph-build-plan.md#phase-6--reducers-annotatedlist-operatoradd) in `app/agent/`. If this file disagrees with code, trust the code.

**Prerequisite:** [phase-5-flow.md](phase-5-flow.md) (sub-graphs). **Next:** [phase-7-flow.md](phase-7-flow.md) (parallel diagram workers via `Send`).

---

## 1. Goal

Prove and adopt reducer-backed list fields so multiple graph nodes (especially parallel workers) can each append artifacts without overwriting earlier writes.

Phase 6 adds **no new graph nodes** and **no new LLM calls**—only shared state types and a focused pytest experiment.

---

## 2. Problem

LangGraph merges node return values into shared state. For a plain `list` field, **the last writer wins**.

Two sequential nodes that each return:

```python
{"generated_diagrams": [one_diagram_entry]}
```

leave `len(generated_diagrams) == 1`. The first entry is gone with no error.

The same failure mode applies when Phase 7 runs parallel `Send` workers: without a reducer, only one worker’s diagram survives.

---

## 3. Solution

In `app/agent/state/schema.py`:

```python
from typing import Annotated
import operator

generated_diagrams: Annotated[list["DiagramEntry"], operator.add]
```

`operator.add` on lists is concatenation. Each writer returns **only the new slice**:

```python
{"generated_diagrams": [single_diagram_entry]}
```

LangGraph appends that slice to whatever is already in state.

---

## 4. `DiagramEntry`

Defined in `app/agent/state/schema.py`:

| Field | Role |
|-------|------|
| `diagram_type` | Plan id, e.g. `"overview"`, `"component-api-gateway"`, `"auth-flow"` |
| `component_slug` | Component slug (`"api-gateway"`) or `""` for cross-cutting diagrams |
| `content` | Raw Mermaid, or `"syntax_error"` when lint retries are exhausted (Phase 7) |
| `path` | Logical key: `diagrams/{thread_id}/iter{n}_{diagram_type}.mmd` |
| `iteration` | Swarm pass number |

`component_slug` is established in Phase 6 so Phase 8 doc workers can pair `.md` files with diagrams using the same slug.

---

## 5. What changed in the repo

| Location | Change |
|----------|--------|
| `app/agent/state/schema.py` | `DiagramEntry`; `generated_diagrams` on `GlobalSwarmState` with `operator.add` |
| `app/services/swarm_graph_service.py` | `_empty_swarm_state` initializes `generated_diagrams: []` |
| `tests/test_reducer_phase6.py` | Isolated graph proving overwrite vs append |
| `app/schemas/swarm.py` | `DiagramEntryResponse`, `generated_diagrams` on `SwarmRunResponse` (used once Phase 7 fills the list) |

No changes to `architect_graph.py` topology are required for Phase 6 alone—the reducer must exist **before** wiring parallel workers in Phase 7.

---

## 6. The experiment (`tests/test_reducer_phase6.py`)

A minimal `StateGraph` with two sequential nodes, each appending one fake `DiagramEntry`:

| State schema | Result after both nodes |
|--------------|-------------------------|
| `generated_diagrams: list[DiagramEntry]` (plain) | Length **1** — second node overwrote the first |
| `generated_diagrams: Annotated[list[DiagramEntry], operator.add]` | Length **2** — both entries kept |

A third test asserts `GlobalSwarmState` actually annotates `generated_diagrams` with `operator.add`.

```bash
cd ai-backend && pytest tests/test_reducer_phase6.py -v
```

---

## 7. Rules for writers

1. Return **only new items** in the list field—never the full accumulated list (except at an explicit reduce step that uses `Overwrite`; see [phase-7-flow.md](phase-7-flow.md)).
2. Use `Annotated[..., operator.add]` on any field that receives **parallel** writes.
3. Missing reducer → silent data loss, not a runtime error.

---

## 8. Verification checklist

| # | Criterion | How |
|---|-----------|-----|
| 1 | Plain list overwrites | `test_plain_list_keeps_only_last_writer` |
| 2 | Reducer appends | `test_reducer_appends_both_entries` |
| 3 | Production state uses reducer | `test_global_swarm_state_uses_reducer_for_generated_diagrams` |

---

## 9. Related docs

- [phase-7-flow.md](phase-7-flow.md) — `Send` fan-out that depends on this reducer
- [phase-5-flow.md](phase-5-flow.md) — architect sub-graph before diagram workers
- [langchain-langgraph-build-plan.md](../learning/langchain-langgraph-build-plan.md) — learning goals and acceptance criteria
- [current/project-state.md](../current/project-state.md) — live system snapshot

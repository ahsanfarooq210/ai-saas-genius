# Subgraph state transfer

This document explains how data moves from `architect_graph` and `doc_generator_graph` back into the parent `GlobalSwarmState`.

Short version:

- The parent graph mounts each compiled subgraph as a node.
- Parent state and subgraph state share field names.
- Subgraph nodes return updates for those shared fields.
- When the subgraph finishes, LangGraph merges the final shared-field values back into `GlobalSwarmState`.
- Parallel worker state is temporary; it reaches the parent only when a worker returns an update to a shared graph field.

## Where the boundary is

The parent graph is built with `StateGraph(GlobalSwarmState)` in `app/agent/graphs/supervisor_graph.py`.

The compiled subgraphs are mounted like normal graph nodes:

```python
builder.add_node("architect_graph", architect_graph)
builder.add_node("doc_generator_graph", doc_generator_graph)
```

Then each subgraph edges back to the supervisor:

```python
builder.add_edge("architect_graph", "supervisor_node")
builder.add_edge("doc_generator_graph", "supervisor_node")
```

That means the parent treats each subgraph as one black-box node:

```text
GlobalSwarmState
  -> supervisor routes to compiled subgraph
  -> subgraph runs internally
  -> subgraph emits final state updates
  -> LangGraph merges those updates into GlobalSwarmState
  -> supervisor reads updated GlobalSwarmState on the next lap
```

The service and supervisor do not manually copy fields from subgraph state into parent state.

## Shared state keys

State transfer works because the parent and subgraphs share field names.

| Field | Parent | Architect subgraph | Doc subgraph |
|-------|--------|--------------------|--------------|
| `task_requirement` | yes | yes | yes |
| `thread_id` | yes | yes | yes |
| `architecture_json` | yes | yes | yes |
| `component_list` | yes | yes | yes |
| `current_architecture_mermaid` | yes | yes | yes |
| `complexity_score` | yes | yes | yes |
| `diagram_plan` | yes | yes | yes |
| `doc_plan` | yes | yes | yes |
| `generated_diagrams` | yes | yes | yes |
| `generated_docs` | yes | yes | yes |
| `docs_complete` | yes | yes | yes |
| `iteration_count` | yes | yes | yes |
| `next_agent` | yes | yes | yes |
| `scalability_feedback` | yes | yes | yes |
| `security_feedback` | yes | yes | yes |
| `debate_logs` | yes | yes | yes |

This overlap lets a subgraph read current parent values and return updated values on the same channels.

## Architect subgraph transfer

When the supervisor routes to `architect_graph`, the architect subgraph receives the current parent state and runs:

```text
prepare_architect_artifacts_node
  -> draft_architecture_node
  -> score_complexity_node
  -> diagram workers
  -> reduce_diagrams_node
```

Important updates written by the subgraph:

| Field | Node that writes it | What parent sees after subgraph finishes |
|-------|---------------------|------------------------------------------|
| `generated_diagrams` | `prepare_architect_artifacts_node`, diagram workers, `reduce_diagrams_node` | final valid diagram artifact metadata |
| `generated_docs` | `prepare_architect_artifacts_node` | cleared docs after an architecture rerun |
| `docs_complete` | `prepare_architect_artifacts_node` | false after architecture changes |
| `architecture_json` | `draft_architecture_node` | new or revised architecture structure |
| `component_list` | `draft_architecture_node` | components used by later phases |
| `current_architecture_mermaid` | `draft_architecture_node` | architecture overview Mermaid text |
| `complexity_score` | `score_complexity_node` | final complexity score |
| `diagram_plan` | `score_complexity_node` | diagram worker plan |
| `doc_plan` | `score_complexity_node` | doc worker plan |

After the subgraph finishes, `supervisor_node` runs again and reads those fields from `GlobalSwarmState`.

## Doc subgraph transfer

When the supervisor routes to `doc_generator_graph`, the doc subgraph receives the current parent state. It especially needs:

- `architecture_json`
- `doc_plan`
- `generated_diagrams`
- `thread_id`
- `iteration_count`

Then it runs:

```text
prepare_doc_artifacts_node
  -> document workers
  -> reduce_docs_node
```

Important updates written by the subgraph:

| Field | Node that writes it | What parent sees after subgraph finishes |
|-------|---------------------|------------------------------------------|
| `generated_docs` | `prepare_doc_artifacts_node`, document workers, `reduce_docs_node` | final doc artifact metadata |
| `docs_complete` | `prepare_doc_artifacts_node`, `reduce_docs_node` | true after docs are reduced |

The next supervisor lap sees `docs_complete=True`, so routing can advance to reviewers.

## Worker state is not parent state

`Send(...)` workers receive isolated worker state:

- `DiagramWorkerState`
- `DocWorkerState`

Those worker payloads are temporary and branch-local. They do not become part of `GlobalSwarmState`.

Only returned updates on shared graph fields transfer back.

Example diagram worker return:

```python
{
    "generated_diagrams": [one_diagram_entry],
}
```

Example doc worker return:

```python
{
    "generated_docs": [one_doc_entry],
}
```

The worker-specific fields such as `draft_mermaid`, `linter_errors`, `internal_loop_count`, and `doc_filename` stay inside the worker path unless a node explicitly writes them to a shared graph field.

## Reducers and overwrite

There are two merge scopes:

| Scope | State field behavior | Why |
|-------|----------------------|-----|
| Inside architect subgraph | `generated_diagrams: Annotated[..., operator.add]` | parallel diagram workers append one result each |
| Inside doc subgraph | `generated_docs: Annotated[..., operator.add]` | parallel doc workers append one result each |
| Parent `GlobalSwarmState` | plain `list` fields | completed subgraph output replaces prior artifacts on reruns |

At fan-in, reduce nodes return `Overwrite(...)`:

```python
return {"generated_diagrams": Overwrite(valid_diagrams)}
```

```python
return {
    "generated_docs": Overwrite(all_docs),
    "docs_complete": True,
}
```

This converts parallel worker accumulation into one final replacement value for the parent graph.

## Why parent state stays plain

Parent `GlobalSwarmState.generated_diagrams` and `GlobalSwarmState.generated_docs` intentionally stay plain lists.

If those parent fields used `operator.add`, reviewer-driven reruns could append new artifacts to old artifacts and duplicate results.

If the subgraph-local fields did not use `operator.add`, parallel workers could overwrite each other and only one diagram/doc might survive.

So the rule is:

```text
subgraph worker accumulator -> reducer
parent final artifact field -> plain replacement
fan-in node -> Overwrite(final_list)
```

## End-to-end example

Diagram generation follows this path:

```text
GlobalSwarmState.diagram_plan
  -> architect_graph receives parent state
  -> diagram_planner_node creates Send workers
  -> each worker returns {"generated_diagrams": [one_entry]}
  -> ArchitectGraphState.generated_diagrams uses operator.add
  -> reduce_diagrams_node filters and returns Overwrite(valid_diagrams)
  -> architect_graph exits
  -> GlobalSwarmState.generated_diagrams is now the final valid diagram list
  -> supervisor_node reads parent state on the next lap
```

Documentation generation follows the same pattern with `generated_docs`.

## What does not transfer

These do not automatically transfer to the parent:

- worker-only fields
- local scratchpad fields
- values only passed into a `Send(...)` payload
- data written to external artifact storage unless metadata is returned into graph state
- database rows; app table writes happen later in `SwarmGraphService`

Artifact content is uploaded by workers, but the parent only receives artifact metadata such as `storage_key` and `url`.

## How this connects to persistence

After a blocking graph run finishes, `SwarmGraphService._mark_session_done(...)` receives the final `GlobalSwarmState` result and writes the app-table projection.

After a streaming graph run finishes, the service calls `aget_state(...)`, reads the final checkpoint snapshot values, and then writes the same app-table projection.

So the data path is:

```text
subgraph node returns update
  -> subgraph state
  -> parent GlobalSwarmState
  -> final graph result or checkpoint snapshot
  -> SwarmGraphService._mark_session_done(...)
  -> sessions/session_artifacts/debate_logs
```

## Files to read

Read these in order when changing transfer behavior:

1. `app/agent/state/schema.py`
2. `app/agent/graphs/supervisor_graph.py`
3. `app/agent/graphs/architect_graph.py`
4. `app/agent/graphs/doc_generator_graph.py`
5. `app/agent/subagents/artifact_reset.py`
6. `app/agent/subagents/reduce_diagrams.py`
7. `app/agent/subagents/reduce_docs.py`
8. `tests/test_subgraph_artifact_accumulation.py`
9. `tests/test_reducer_phase6.py`
10. `tests/test_reducer_phase8.py`

## Related docs

- [overview.md](overview.md)
- [architect-subgraph.md](architect-subgraph.md)
- [doc-generator-subgraph.md](doc-generator-subgraph.md)
- [`../flows/subgraph-state-transfer.md`](../flows/subgraph-state-transfer.md)
- [`../flows/state-merge-and-artifacts.md`](../flows/state-merge-and-artifacts.md)


# Architect subgraph

The architect subgraph creates or revises the architecture, scores complexity, plans diagrams/docs, generates Mermaid diagram artifacts in parallel, and returns the final diagram list to the parent graph.

## Source files

| File | Role |
|------|------|
| `app/agent/graphs/architect_graph.py` | subgraph topology |
| `app/agent/subagents/artifact_reset.py` | reset node before reruns |
| `app/agent/subagents/lead_architect.py` | structured architecture generation |
| `app/agent/subagents/comlexity_analyzer.py` | complexity score, diagram plan, doc plan |
| `app/agent/subagents/diagram_planner.py` | `Send` fan-out into diagram workers |
| `app/agent/subagents/diagram_generator_worker.py` | Mermaid generation, linting, artifact upload |
| `app/agent/subagents/reduce_diagrams.py` | fan-in barrier and valid diagram filtering |
| `app/agent/state/schema.py` | `ArchitectGraphState` and `DiagramWorkerState` |

`comlexity_analyzer.py` is intentionally misspelled in the live import path. Do not rename it casually.

## Topology

```text
START
  -> prepare_architect_artifacts_node
  -> draft_architecture_node
  -> score_complexity_node
  -> diagram_planner_node
       -> Send x len(diagram_plan) to diagram_generator_node
  -> reduce_diagrams_node
  -> END
```

`diagram_planner_node` is a conditional edge function, not a normal graph node. It returns a list of LangGraph `Send` objects.

## Inputs

The subgraph receives the current parent state. Important inputs:

| Field | Why it matters |
|-------|----------------|
| `task_requirement` | base user requirement |
| `thread_id` | artifact path namespace |
| `iteration_count` | artifact iteration metadata |
| `scalability_feedback`, `security_feedback` | revision guidance after reviewer rejection |

On the first run, architecture fields are empty. On a rerun, feedback fields may contain the reviewer critique that caused the supervisor to route back here.

## Outputs

The subgraph returns updates to parent state:

| Field | Written by |
|-------|------------|
| `architecture_json` | `draft_architecture_node` |
| `component_list` | `draft_architecture_node` |
| `current_architecture_mermaid` | `draft_architecture_node` |
| `complexity_score` | `score_complexity_node` |
| `diagram_plan` | `score_complexity_node` |
| `doc_plan` | `score_complexity_node` |
| `generated_diagrams` | diagram workers plus `reduce_diagrams_node` |
| `generated_docs`, `docs_complete` reset | `prepare_architect_artifacts_node` |

The architect writes `doc_plan`, but it does not generate Markdown docs. The supervisor routes to `doc_generator_graph` after this subgraph when `docs_complete` is false.

## Reset behavior

`prepare_architect_artifacts_node` runs first every time the subgraph starts. It:

- overwrites `generated_diagrams` with an empty list
- clears `generated_docs`
- sets `docs_complete` to false

This is required after reviewer rejection. A revised architecture should not keep stale diagrams or docs from the previous architecture pass.

## Parallel diagram generation

`score_complexity_node` produces `diagram_plan`. The planner turns each plan entry into one isolated `DiagramWorkerState`.

Each diagram worker:

1. Asks the LLM for Mermaid source.
2. Strips Markdown code fences if present.
3. Runs the Mermaid linter.
4. Retries up to three lint attempts.
5. Uploads valid Mermaid content through `artifact_store.upload_diagram(...)`.
6. Returns one `DiagramEntry` containing `diagram_type`, `component_slug`, `storage_key`, `url`, and `iteration`.

If a diagram fails after all lint attempts, the worker returns an entry with empty `storage_key` and `url`.

## Fan-in and reducers

`ArchitectGraphState.generated_diagrams` uses `operator.add` so every parallel worker can append its one-item list.

`reduce_diagrams_node` is the fan-in barrier. It:

- waits until every diagram worker is done
- drops failed entries that do not have both `storage_key` and `url`
- returns `Overwrite(valid_diagrams)`

The overwrite step prevents duplicate diagrams when the subgraph output is merged back into parent state.

## Artifact storage

Raw Mermaid source is not stored in graph state. The worker uploads the Mermaid content to the configured artifact store and keeps only metadata in state:

- `storage_key`
- `url`
- diagram type and slug metadata

That state metadata is later mirrored into `session_artifacts` by `SwarmGraphService._mark_session_done(...)`.

## Current slug note

Diagram component entries such as `component-api-gateway` are converted to `component_slug="api-gateway"` by `diagram_planner_node`.

The documentation path treats doc plan entries as filenames. If the model emits `component-api-gateway.md`, the doc worker slug becomes `component-api-gateway`. That means component doc-to-diagram pairing can miss unless slug normalization is improved. Overview pairing works because both use an empty component slug.

## Related docs

- [overview.md](overview.md)
- [supervisor-graph.md](supervisor-graph.md)
- [doc-generator-subgraph.md](doc-generator-subgraph.md)
- [`../flows/state-merge-and-artifacts.md`](../flows/state-merge-and-artifacts.md)


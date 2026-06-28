# Doc generator subgraph

The doc generator subgraph creates Markdown documentation artifacts from the architecture, doc plan, and generated diagrams.

## Source files

| File | Role |
|------|------|
| `app/agent/graphs/doc_generator_graph.py` | subgraph topology |
| `app/agent/subagents/artifact_reset.py` | reset node before doc generation |
| `app/agent/subagents/doc_planner.py` | `Send` fan-out into document workers |
| `app/agent/subagents/document_generator_worker.py` | Markdown generation and artifact upload |
| `app/agent/subagents/reduce_docs.py` | fan-in barrier and `docs_complete` update |
| `app/agent/state/schema.py` | `DocGraphState` and `DocWorkerState` |

## Topology

```text
START
  -> prepare_doc_artifacts_node
  -> doc_planner_node
       -> Send x len(doc_plan) to document_generator_node
  -> reduce_docs_node
  -> END
```

`doc_planner_node` is a conditional edge function, not a normal graph node. It returns a list of LangGraph `Send` objects.

## Inputs

The supervisor routes here when:

- `component_list` is populated
- `docs_complete` is false

Important state inputs:

| Field | Why it matters |
|-------|----------------|
| `task_requirement` | context for every doc |
| `architecture_json` | primary source material |
| `doc_plan` | filenames to generate |
| `generated_diagrams` | available diagram URLs for related diagram sections |
| `thread_id` | artifact path namespace |
| `iteration_count` | worker metadata |

`doc_plan` is produced upstream by the architect subgraph's complexity analyzer.

## Outputs

The subgraph returns:

| Field | Written by |
|-------|------------|
| `generated_docs` | document workers plus `reduce_docs_node` |
| `docs_complete` | `reduce_docs_node` |

Each `DocEntry` contains:

- `title`
- `component_slug`
- `storage_key`
- `url`

Raw Markdown content is stored in the artifact store, not in graph state.

## Reset behavior

`prepare_doc_artifacts_node` runs first every time the subgraph starts. It:

- overwrites `generated_docs` with an empty list
- sets `docs_complete` to false

This prevents stale docs from surviving a rerun.

## Parallel document generation

`doc_planner_node` creates one isolated `DocWorkerState` per `doc_plan` entry.

Each document worker:

1. Converts the filename to a document title.
2. Computes a `component_slug`.
3. Looks for a paired diagram URL.
4. Sends architecture context, available diagrams, and paired diagram information to the LLM.
5. Uploads the Markdown content through `artifact_store.upload_doc(...)`.
6. Returns one `DocEntry`.

The worker includes all available diagram URLs in the prompt, and asks the LLM to include a "Related Diagrams" section.

## Fan-in and reducers

`DocGraphState.generated_docs` uses `operator.add` so every parallel worker can append its one-item list.

`reduce_docs_node` is the fan-in barrier. It:

- waits until all document workers are done
- returns `Overwrite(all_docs)`
- sets `docs_complete` to true

The supervisor uses `docs_complete` as the gate before routing to reviewer nodes.

## Pairing behavior

Overview docs pair to the overview diagram because both use an empty component slug.

Component doc pairing depends on matching `component_slug`. Today, the diagram path strips the `component-` prefix while the doc path keeps whatever filename stem it receives. If `doc_plan` contains `component-api-gateway.md`, the doc slug is `component-api-gateway`, while the paired diagram slug is `api-gateway`. That mismatch is a known current limitation.

## Related docs

- [overview.md](overview.md)
- [supervisor-graph.md](supervisor-graph.md)
- [architect-subgraph.md](architect-subgraph.md)
- [`../flows/phase-8-flow.md`](../flows/phase-8-flow.md)


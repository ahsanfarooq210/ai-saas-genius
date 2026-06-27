# Change: Subgraph artifact merge fix (duplicate diagrams / docs)

**Date:** 2026-05-30

## Symptom

API responses and checkpoints could contain **duplicate** `generated_diagrams` and `generated_docs` entries (same `storage_key` repeated 2× or more). Example: 23 unique report keys appearing 46 times in `generated_docs`, with `docs_complete: false` at the end of some runs.

## Root cause

`GlobalSwarmState` annotated `generated_diagrams`, `generated_docs`, and `debate_logs` with `operator.add`. That is correct **inside** a subgraph where parallel `Send` workers each return a one-item list slice.

It is **wrong on the parent graph** when compiled subgraphs are mounted as nodes. When `architect_graph` or `doc_generator_graph` finishes, LangGraph merges the subgraph’s output into the parent using the **parent’s** reducers. The subgraph output already contains the **full accumulated list**. Appending that list again at the parent duplicated every artifact:

```text
after architect:  diagrams = [A, B]
after docs:       diagrams = [A, B, A, B]   # doc subgraph passed diagrams through unchanged
```

The same pattern affected `debate_logs` when reviewer nodes returned log slices.

## Fix

1. **Parent `GlobalSwarmState`** — `generated_diagrams`, `generated_docs`, and `debate_logs` are **plain lists** (replace on merge, not append).

2. **Subgraph-local state** — `ArchitectGraphState.generated_diagrams` and `DocGraphState.generated_docs` keep `Annotated[..., operator.add]` for parallel workers only.

3. **Artifact reset nodes** — [`artifact_reset.py`](../../app/agent/subagents/artifact_reset.py):
   - `prepare_architect_artifacts_node` at architect `START` clears diagrams/docs and `docs_complete`
   - `prepare_doc_artifacts_node` at doc `START` clears docs before each generation pass

4. **Reviewer logs** — [`append_debate_log()`](../../app/agent/subagents/reviewer_common.py) builds `old_logs + [new_entry]` explicitly; parent replaces `debate_logs`.

## Files touched

| Area | Files |
|------|--------|
| State | `app/agent/state/schema.py` |
| Graphs | `app/agent/graphs/architect_graph.py`, `doc_generator_graph.py` |
| Reset | `app/agent/subagents/artifact_reset.py` |
| Reviewers | `reviewer_common.py`, `scalability_expert.py`, `security_auditor.py` |
| Tests | `tests/test_subgraph_artifact_accumulation.py`, `test_reducer_phase6.py`, `test_reducer_phase8.py` |

## Contract to preserve when extending state

| Scope | Merge semantics |
|-------|-----------------|
| Parallel worker inside subgraph | Return one-item list; field uses `operator.add` |
| Reduce node inside subgraph | May use `Overwrite` to collapse worker accumulation |
| Compiled subgraph → parent | Parent field is plain list → **replace** |
| Rerun generation phase | Call prepare/reset node or clear artifacts intentionally |

See [state-merge-and-artifacts.md](../flows/state-merge-and-artifacts.md).

## Migration notes for contributors

- Do **not** add `operator.add` back onto `GlobalSwarmState` artifact fields.
- If you add a new compiled subgraph that returns list fields, use a **subgraph-local** `TypedDict` with reducers only where `Send` workers append.
- Add a regression test in `tests/test_subgraph_artifact_accumulation.py` when mounting a new subgraph on the parent.

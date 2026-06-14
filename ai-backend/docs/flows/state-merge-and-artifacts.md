# State merge and artifacts

**If this file disagrees with code, trust** [`app/agent/state/schema.py`](../../app/agent/state/schema.py) **and** [`tests/test_subgraph_artifact_accumulation.py`](../../tests/test_subgraph_artifact_accumulation.py).

This document explains **how list fields merge** in the swarm and why duplicate diagrams/docs appeared before the 2026-05-30 fix. Read it before changing `GlobalSwarmState` or adding reducers.

If you want the simpler "how do subgraph outputs get into `GlobalSwarmState`?" explanation first, start with [subgraph-state-transfer.md](subgraph-state-transfer.md).

**Related:** [how-the-swarm-graph-works.md](../current/how-the-swarm-graph-works.md) (full flow), [2026-05-30-subgraph-artifact-merge-fix.md](../changes/2026-05-30-subgraph-artifact-merge-fix.md) (changelog).

---

## 1. The rule (read this first)

| Where | Field examples | Merge behavior |
|-------|----------------|----------------|
| **Parent** `GlobalSwarmState` | `generated_diagrams`, `generated_docs`, `debate_logs` | **Plain `list`** — last subgraph/node output **replaces** the field |
| **Architect subgraph** `ArchitectGraphState` | `generated_diagrams` | `Annotated[list, operator.add]` — parallel diagram workers **append** one entry each |
| **Doc subgraph** `DocGraphState` | `generated_docs` | `Annotated[list, operator.add]` — parallel doc workers **append** one entry each |
| **Worker** `Send` payload | `DiagramWorkerState`, `DocWorkerState` | Isolated copy per branch; workers return a **one-element** list slice |

**Mental model:**

- **Worker scope** → append (reducer)
- **Subgraph finished output → parent** → replace (plain list)
- **Regeneration after rejection** → reset at subgraph `START`, then replace on return

A reducer is **not** “this field should always append forever.” It means: *within this execution scope, multiple parallel writers contribute partial values.*

---

## 2. What went wrong before the fix

Parent `GlobalSwarmState` used `operator.add` on artifact lists. Compiled subgraphs were mounted on the supervisor graph as ordinary nodes. When a subgraph completed, LangGraph merged its channels into the parent using **parent reducers**.

The doc subgraph does not regenerate diagrams; it only reads them. But its **final state snapshot** still includes the same `generated_diagrams` list it received. The parent then **concatenated** that full list onto what was already stored:

```text
Step 1 — architect finishes:
  parent.generated_diagrams = [] + [overview, api-gateway]  →  [overview, api-gateway]

Step 2 — doc subgraph finishes (diagrams unchanged in snapshot):
  parent.generated_diagrams = [overview, api-gateway] + [overview, api-gateway]
  →  [overview, api-gateway, overview, api-gateway]
```

The same failure mode hit `generated_docs` on later passes and `debate_logs` when reviewers returned log updates.

---

## 3. State types in code

Defined in [`schema.py`](../../app/agent/state/schema.py):

### `GlobalSwarmState` (parent supervisor graph)

- `generated_diagrams: list[DiagramEntry]` — **no reducer**
- `generated_docs: list[DocEntry]` — **no reducer**
- `debate_logs: list[DebateLogEntry]` — **no reducer**
- `docs_complete: bool` — normal last-write wins

### `ArchitectGraphState` (`architect_graph`)

- `generated_diagrams: Annotated[list[DiagramEntry], operator.add]` — reducer **only here**
- Other fields mirror parent for handoff; `generated_docs` is a plain list cleared on prepare

### `DocGraphState` (`doc_generator_graph`)

- `generated_docs: Annotated[list[DocEntry], operator.add]` — reducer **only here**
- `generated_diagrams: list[DiagramEntry]` — **read-only input** from parent (plain list)

### Worker states (isolated per `Send`)

- `DiagramWorkerState` — one diagram job; no shared reducer field on global state
- `DocWorkerState` — carries a **copy** of `generated_diagrams` for pairing at fan-out time

---

## 4. Parallel workers and reduce nodes

### Diagram workers (inside `architect_graph`)

Each `diagram_generator_node` returns:

```python
{"generated_diagrams": [single_diagram_entry]}
```

LangGraph appends each slice into `ArchitectGraphState.generated_diagrams`.

[`reduce_diagrams_node`](../../app/agent/subagents/reduce_diagrams.py) then:

1. Reads the merged list
2. Drops `content == "syntax_error"`
3. Returns `{"generated_diagrams": Overwrite(valid_diagrams)}`

`Overwrite` collapses the reducer accumulation **inside the subgraph** to one clean list. That is separate from parent merge semantics.

### Doc workers (inside `doc_generator_graph`)

Same pattern: each worker returns one `DocEntry`; reducer appends.

[`reduce_docs_node`](../../app/agent/subagents/reduce_docs.py) returns:

```python
{
    "generated_docs": Overwrite(all_docs),
    "docs_complete": True,
}
```

---

## 5. Artifact reset on rerun

[`artifact_reset.py`](../../app/agent/subagents/artifact_reset.py):

| Node | Graph | Clears |
|------|-------|--------|
| `prepare_architect_artifacts_node` | `architect_graph` @ `START` | `generated_diagrams` (Overwrite `[]`), `generated_docs` → `[]`, `docs_complete` → `False` |
| `prepare_doc_artifacts_node` | `doc_generator_graph` @ `START` | `generated_docs` (Overwrite `[]`), `docs_complete` → `False` |

**Why:** After scalability/security `REJECTED`, the supervisor routes back to `architect_graph`. Architecture and plans change; old diagrams and docs must not remain in state or get merged into the next pass.

After architect rerun, parent receives fresh diagrams and empty docs until `doc_generator_graph` runs again.

---

## 6. Debate logs (no parent reducer)

Reviewers use [`append_debate_log()`](../../app/agent/subagents/reviewer_common.py):

```python
debate_logs = [*existing_logs, new_entry]
```

The node returns the **full** list. Parent `debate_logs` is a plain list, so the field is **replaced** with that full list — one intentional append per review, not accidental double-merge from subgraph snapshots.

---

## 7. Walkthrough: reject and rerun

Path: `architect → docs → scalability (REJECTED) → architect → …`

| Step | `generated_diagrams` (parent) | `generated_docs` | `docs_complete` |
|------|------------------------------|------------------|-----------------|
| After 1st architect | `[A, B]` (replace) | `[]` (cleared at architect start) | `False` |
| After docs | `[A, B]` (unchanged — not re-appended) | `[doc1, doc2]` (replace) | `True` |
| After scalability reject | same | same | same |
| After 2nd architect (prepare clears) | `[C, D]` (replace) | `[]` (cleared) | `False` |
| Supervisor next | routes to `doc_generator_graph` again | | |

Without parent plain lists, step “after docs” would have doubled diagrams. Without prepare nodes, step “after 2nd architect” could mix `[A,B,C,D]` and stale docs.

---

## 8. Tests that lock the contract

| Test file | What it proves |
|-----------|----------------|
| [`test_subgraph_artifact_accumulation.py`](../../tests/test_subgraph_artifact_accumulation.py) | Compiled `architect → doc` does not duplicate diagrams; architect rerun replaces artifacts; one debate log |
| [`test_reducer_phase6.py`](../../tests/test_reducer_phase6.py) | Parent plain `generated_diagrams`; `ArchitectGraphState` has reducer |
| [`test_reducer_phase8.py`](../../tests/test_reducer_phase8.py) | Parent plain `generated_docs`; `DocGraphState` has reducer |

Run:

```bash
pytest tests/test_subgraph_artifact_accumulation.py tests/test_reducer_phase6.py tests/test_reducer_phase8.py -q
```

---

## 9. Checklist when adding state or subgraphs

1. Will parallel `Send` workers write the same field? → reducer on **subgraph** state only.
2. Will a compiled subgraph return that field to the parent? → parent field must be a **plain list** (or explicit full replacement for logs).
3. Should a rerun clear old artifacts? → add or call a prepare/reset node at subgraph `START`.
4. Add a regression test under `test_subgraph_artifact_accumulation.py` if you mount a new subgraph on the parent.

---

## 10. Related docs

- [how-the-swarm-graph-works.md](../current/how-the-swarm-graph-works.md)
- [swarm-graph-overview.md](swarm-graph-overview.md)
- [phase-7-flow.md](phase-7-flow.md) / [phase-8-flow.md](phase-8-flow.md) — `Send` worker details

# Subgraph state transfer to `GlobalSwarmState`

**If this file disagrees with code, trust** [`app/agent/state/schema.py`](../../app/agent/state/schema.py), [`app/agent/graphs/supervisor_graph.py`](../../app/agent/graphs/supervisor_graph.py), and [`tests/test_subgraph_artifact_accumulation.py`](../../tests/test_subgraph_artifact_accumulation.py).

This document explains one specific question:

> When `supervisor_graph` runs `architect_graph` or `doc_generator_graph`, how do the subgraph outputs end up in `GlobalSwarmState`?

For the shorter current-runtime reference, read [`../graphs/subgraph-state-transfer.md`](../graphs/subgraph-state-transfer.md). This file keeps the deeper historical explanation and proof points.

If you want the shorter answer first:

- The parent graph mounts each compiled subgraph as a node.
- The parent and subgraphs share some state keys with the same names.
- Nodes inside the subgraph return updates for those shared keys.
- When the subgraph finishes, LangGraph merges those returned values back into the parent state.

For reducer details and duplicate-artifact history, read [state-merge-and-artifacts.md](state-merge-and-artifacts.md).

---

## 1. The mental model

Treat each compiled subgraph as a black-box node inside the parent graph.

In this repo, the parent graph is [`supervisor_graph.py`](../../app/agent/graphs/supervisor_graph.py):

- `GlobalSwarmState` is the parent state
- `architect_graph` is added as a node
- `doc_generator_graph` is added as a node

That means the flow is effectively:

```text
GlobalSwarmState
  -> run compiled subgraph as one node
  -> subgraph finishes
  -> subgraph state updates merge back into GlobalSwarmState
```

The supervisor does **not** manually copy values from one state object to another.

---

## 2. Where this happens in code

In [`supervisor_graph.py`](../../app/agent/graphs/supervisor_graph.py), the parent graph is built with `StateGraph(GlobalSwarmState)` and registers the compiled subgraphs as ordinary nodes:

```python
builder = StateGraph(GlobalSwarmState)

builder.add_node("architect_graph", architect_graph)
builder.add_node("doc_generator_graph", doc_generator_graph)
```

Later, control returns to `supervisor_node`:

```python
builder.add_edge("architect_graph", "supervisor_node")
builder.add_edge("doc_generator_graph", "supervisor_node")
```

So the sequence is:

1. `supervisor_node` routes to a subgraph
2. the subgraph runs using the current parent state
3. the subgraph returns updates
4. those updates are now present in `GlobalSwarmState`
5. `supervisor_node` reads them on the next pass

---

## 3. Why shared field names matter

This works because the subgraph state types reuse many of the same fields defined on `GlobalSwarmState`.

Defined in [`schema.py`](../../app/agent/state/schema.py):

### Parent state

`GlobalSwarmState` includes fields such as:

- `architecture_json`
- `component_list`
- `diagram_plan`
- `doc_plan`
- `generated_diagrams`
- `generated_docs`
- `docs_complete`
- `scalability_feedback`
- `security_feedback`

### Architect subgraph state

`ArchitectGraphState` includes many of those same fields, including:

- `architecture_json`
- `component_list`
- `diagram_plan`
- `generated_diagrams`
- `generated_docs`
- `docs_complete`

### Doc subgraph state

`DocGraphState` also includes overlapping fields, including:

- `generated_diagrams`
- `generated_docs`
- `docs_complete`
- `doc_plan`

The overlap is intentional. It is what allows the subgraphs to consume parent state and return updates on the same channels.

---

## 4. What actually gets written back

Matching field names alone are not enough. A node inside the subgraph must actually **return** an update for that field.

Examples from this repo:

### Architect subgraph output

Inside [`reduce_diagrams.py`](../../app/agent/subagents/reduce_diagrams.py), the final node in the architect subgraph returns:

```python
return {"generated_diagrams": _overwrite(valid_diagrams)}
```

That means the architect subgraph finishes with a value for `generated_diagrams`.

Because `generated_diagrams` also exists on `GlobalSwarmState`, that updated value becomes part of the parent state after the subgraph node completes.

### Doc subgraph output

Inside [`reduce_docs.py`](../../app/agent/subagents/reduce_docs.py), the final node in the doc subgraph returns:

```python
return {
    "generated_docs": _overwrite(all_docs),
    "docs_complete": True,
}
```

So when the doc subgraph finishes, the parent state now has:

- updated `generated_docs`
- updated `docs_complete`

The supervisor then reads `docs_complete` to decide what to do next.

---

## 5. Step-by-step example: `generated_diagrams`

This is the cleanest field to follow end to end.

### Step 1. Parent routes to `architect_graph`

`supervisor_node` decides the next branch is `architect_graph`.

### Step 2. Diagram workers run inside the subgraph

Inside the architect subgraph, `diagram_planner_node` fans out `Send` workers.

Each worker returns one slice like:

```python
{"generated_diagrams": [one_diagram_entry]}
```

### Step 3. Subgraph reducer accumulates worker outputs

In [`schema.py`](../../app/agent/state/schema.py), `ArchitectGraphState.generated_diagrams` is:

```python
Annotated[list["DiagramEntry"], operator.add]
```

So inside the architect subgraph, LangGraph appends all worker outputs into one list.

### Step 4. Reduce node cleans the final list

`reduce_diagrams_node` removes failed diagrams and returns:

```python
{"generated_diagrams": _overwrite(valid_diagrams)}
```

At this point, the architect subgraph has its final `generated_diagrams` value.

### Step 5. Subgraph exits and parent state is updated

Because `generated_diagrams` is also a field on `GlobalSwarmState`, LangGraph merges that final subgraph value back into the parent.

Now `GlobalSwarmState.generated_diagrams` contains the finished diagrams.

### Step 6. Supervisor sees the updated value

Control returns to `supervisor_node`, and later the doc subgraph can read those diagrams from parent state.

---

## 6. Why worker state does not automatically appear in the parent

Worker state is different from subgraph output state.

For example:

- `DiagramWorkerState`
- `DocWorkerState`

These worker states are isolated payloads for each `Send` branch. They are useful while the worker runs, but they do **not** automatically get copied into `GlobalSwarmState`.

Only fields that are returned by nodes and merged through the graph state channels end up in the parent.

So this:

```python
Send("diagram_generator_node", DiagramWorkerState(...))
```

does **not** mean `DiagramWorkerState` becomes part of `GlobalSwarmState`.

What reaches the parent is the worker's returned update, for example:

```python
{"generated_diagrams": [one_diagram_entry]}
```

---

## 7. Parent merge behavior vs subgraph reducer behavior

There are two different merge scopes in this system.

### Inside a subgraph

Reducers are used where parallel workers need to contribute partial values.

Examples:

- `ArchitectGraphState.generated_diagrams`
- `DocGraphState.generated_docs`

Those use `Annotated[..., operator.add]`.

### At the parent graph level

The parent fields on `GlobalSwarmState` are plain lists:

- `generated_diagrams: list[DiagramEntry]`
- `generated_docs: list[DocEntry]`

That means the parent stores the subgraph's final returned value instead of re-appending the full list again.

This distinction is important. It prevents duplicate artifacts when compiled subgraphs return to the parent.

For the full explanation of that bug and fix, see [state-merge-and-artifacts.md](state-merge-and-artifacts.md).

---

## 8. What the supervisor reads after subgraphs finish

After the subgraphs write back into `GlobalSwarmState`, the supervisor uses those values for routing.

Examples from [`supervisor_router.py`](../../app/agent/subagents/supervisor_router.py):

- if `component_list` is empty -> route to `architect_graph`
- if `docs_complete` is `False` -> route to `doc_generator_graph`
- if `scalability_feedback` contains `REJECTED` -> reroute to `architect_graph`

This only works because the parent state already contains the values produced by earlier subgraph runs.

---

## 9. Simple rule to remember

Use this rule when reading or extending the graph:

1. A subgraph can read parent fields that exist in its own state type.
2. A subgraph can update parent state only by returning updates on shared fields.
3. Worker-local state does not become parent state unless a node writes it into a shared graph field.
4. Reducers are for parallel accumulation inside a subgraph, not for permanent parent-side appending.

---

## 10. Repo proof points

If you want to verify this behavior in the repo, read these files in this order:

1. [`app/agent/state/schema.py`](../../app/agent/state/schema.py)
2. [`app/agent/graphs/supervisor_graph.py`](../../app/agent/graphs/supervisor_graph.py)
3. [`app/agent/graphs/architect_graph.py`](../../app/agent/graphs/architect_graph.py)
4. [`app/agent/graphs/doc_generator_graph.py`](../../app/agent/graphs/doc_generator_graph.py)
5. [`app/agent/subagents/reduce_diagrams.py`](../../app/agent/subagents/reduce_diagrams.py)
6. [`app/agent/subagents/reduce_docs.py`](../../app/agent/subagents/reduce_docs.py)
7. [`tests/test_subgraph_artifact_accumulation.py`](../../tests/test_subgraph_artifact_accumulation.py)

The test file is especially useful because it shows compiled subgraphs mounted on a parent `StateGraph(GlobalSwarmState)` and proves that artifacts from one subgraph are available in the final parent result without duplication.

---

## 11. Related docs

- [state-merge-and-artifacts.md](state-merge-and-artifacts.md)
- [swarm-graph-overview.md](swarm-graph-overview.md)
- [how-the-swarm-graph-works.md](../current/how-the-swarm-graph-works.md)

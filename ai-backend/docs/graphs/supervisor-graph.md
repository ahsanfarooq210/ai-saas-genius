# Supervisor graph

The supervisor graph is the parent LangGraph topology. It owns the loop, routes between phases, and is the graph that receives the runtime checkpointer.

## Source files

| File | Role |
|------|------|
| `app/agent/graphs/supervisor_graph.py` | parent graph topology and runtime compile function |
| `app/agent/subagents/supervisor_router.py` | deterministic supervisor node and routing rules |
| `app/agent/subagents/scalability_expert.py` | scalability reviewer node |
| `app/agent/subagents/security_auditor.py` | security reviewer node |
| `app/agent/state/schema.py` | `GlobalSwarmState` contract |

## Topology

```text
START
  -> supervisor_node
  -> architect_graph | doc_generator_graph | scalability_node | security_node | END
  -> supervisor_node
```

All worker nodes edge back to `supervisor_node`. Each lap re-evaluates the same gates against the latest state.

## Runtime compile

`app/main.py` creates the runtime graph during FastAPI lifespan:

1. Validate app-managed tables exist.
2. Open the Postgres LangGraph checkpointer.
3. Compile `build_supervisor_graph(checkpointer)`.
4. Store `SwarmGraphService(graph)` on `app.state`.

`supervisor_graph.py` also exposes a checkpoint-free module-level graph for topology rendering and tests that do not need runtime checkpoint state.

## Routing rules

The supervisor router is deterministic. It does not call an LLM.

Rules are evaluated in order:

| Order | Gate | Route when gate fails |
|-------|------|-----------------------|
| 1 | `component_list` exists | `architect_graph` |
| 2 | `docs_complete` is true | `doc_generator_graph` |
| 3 | scalability feedback exists and is not rejected | `scalability_node` or `architect_graph` on `REJECTED` |
| 4 | security feedback exists and is not rejected | `security_node` or `architect_graph` on `REJECTED` |
| 5 | all gates passed | `END` |

Reviewer rejection is string-based today. If the feedback contains `REJECTED`, the supervisor routes back to `architect_graph`.

## Iteration cap

`MAX_ITERATIONS = 5`.

`supervisor_node` increments `iteration_count` before routing. Iterations `1` through `5` route normally. Iteration `6` and later force `END`.

This allows the fifth pass to still do useful work, such as routing into documentation after an architect rerun, while preventing infinite reject/revise loops.

## State written by supervisor

Each supervisor lap writes:

| Field | Meaning |
|-------|---------|
| `iteration_count` | incremented lap count |
| `next_agent` | selected next node, also used by conditional edge dispatch |

The supervisor does not mutate artifacts, architecture JSON, docs, or reviewer feedback.

## Reviewer loop

The reviewer nodes are parent-graph nodes, not subgraphs. They write:

- `scalability_feedback` / `security_feedback`
- `debate_logs[]`

The supervisor then uses those fields to decide whether to continue, end, or send the run back through `architect_graph`.

## Related docs

- [overview.md](overview.md)
- [architect-subgraph.md](architect-subgraph.md)
- [doc-generator-subgraph.md](doc-generator-subgraph.md)
- [`../persistence/checkpointer-postgres-alembic.md`](../persistence/checkpointer-postgres-alembic.md)


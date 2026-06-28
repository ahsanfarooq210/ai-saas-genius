# Documentation

This folder is the canonical home for human-readable project documentation.

It answers three questions:

1. **What is live in the code right now?** -> [`current/`](current/)
2. **How does the swarm graph work?** -> [`graphs/`](graphs/)
3. **How is state persisted?** -> [`persistence/`](persistence/)

When code and docs disagree, **trust the code** and update the docs.

---

## Start here (recommended reading order)

Read these in order if you are new to the backend:

| # | Document | Why read it |
|---|----------|-------------|
| 1 | [current/project-state.md](current/project-state.md) | live API, wired features, known gaps, and code map |
| 2 | [current/authentication.md](current/authentication.md) | signup, login, token refresh, and authenticated request examples |
| 3 | [graphs/overview.md](graphs/overview.md) | how API, service, parent graph, subgraphs, checkpoints, and app tables work together |
| 4 | [graphs/subgraph-state-transfer.md](graphs/subgraph-state-transfer.md) | how subgraph outputs merge back into `GlobalSwarmState` |
| 5 | [graphs/supervisor-graph.md](graphs/supervisor-graph.md) | parent loop, deterministic routing, reviewer reruns, iteration cap |
| 6 | [graphs/architect-subgraph.md](graphs/architect-subgraph.md) | architecture drafting, complexity scoring, diagram workers, artifact reset |
| 7 | [graphs/doc-generator-subgraph.md](graphs/doc-generator-subgraph.md) | Markdown doc workers, paired diagrams, doc reduction |
| 8 | [persistence/checkpointer-postgres-alembic.md](persistence/checkpointer-postgres-alembic.md) | external Postgres checkpointer and Alembic-managed app tables |
| 9 | [persistence/session-data-flow.md](persistence/session-data-flow.md) | complete run/resume/session save and read flow |
| 10 | [current/streaming.md](current/streaming.md) | live SSE progress streaming contract and implementation |
| 11 | [architecture/plan.md](architecture/plan.md) | target / roadmap; not guaranteed to match live code |

**Deep dives (optional):**

- [current/how-the-swarm-graph-works.md](current/how-the-swarm-graph-works.md) - older end-to-end graph explanation with broad context
- [flows/subgraph-state-transfer.md](flows/subgraph-state-transfer.md) - deeper historical explanation of subgraph output transfer
- [flows/state-merge-and-artifacts.md](flows/state-merge-and-artifacts.md) - critical reducer/reset details for artifact correctness
- [flows/swarm-graph-overview.md](flows/swarm-graph-overview.md) - node-by-node topology, `Send` fan-out, module map
- [flows/phase-7-flow.md](flows/phase-7-flow.md) — diagram workers, Mermaid lint loop
- [flows/phase-8-flow.md](flows/phase-8-flow.md) — document workers, Cloudinary artifacts, pairing

**Recent change:**

- [current/authentication.md](current/authentication.md) — live JWT signup/login/refresh and request authentication contract
- [changes/2026-06-28-documentation-restructure.md](changes/2026-06-28-documentation-restructure.md) - change log for the graph/persistence docs cleanup
- [current/streaming.md](current/streaming.md) — live SSE progress streaming for swarm runs and resumes
- [changes/2026-06-28-swarm-streaming-progress.md](changes/2026-06-28-swarm-streaming-progress.md) — change log for streaming endpoints, event normalization, and error handling
- [changes/2026-06-28-session-graph-state-persistence.md](changes/2026-06-28-session-graph-state-persistence.md) — change log for persisting final graph-state fields in the `sessions` table
- [current/phase-11-postgres-persistence.md](current/phase-11-postgres-persistence.md) — Phase 11 Postgres checkpointing and app metadata tables
- [changes/2026-05-30-subgraph-artifact-merge-fix.md](changes/2026-05-30-subgraph-artifact-merge-fix.md) — fix for duplicate diagrams/docs in API responses

---

## Folder guide

| Path | Purpose |
|------|---------|
| [current/](current/) | Live system: how it works today, API, known gaps |
| [graphs/](graphs/) | Clean runtime graph reference: parent graph and each subgraph |
| [persistence/](persistence/) | Checkpointer, external Postgres, Alembic, session save/read flows |
| [flows/](flows/) | Graph topology, merge semantics, phase-specific `Send` details |
| [changes/](changes/) | Changelogs for important behavioral fixes |
| [architecture/](architecture/) | Long-term target design ([plan.md](architecture/plan.md)) |
| [learning/](learning/) | Step-by-step build curriculum (pedagogical; may lag live code) |

---

## Documentation rules

- Keep **`current/`**, **`graphs/`**, **`persistence/`**, and **`flows/state-merge-and-artifacts.md`** aligned with `app/agent/state/schema.py`, `app/agent/graphs/`, and `app/services/swarm_graph_service.py`.
- Keep **`architecture/`** as roadmap material unless the implementation matches.
- When you add a state field, graph node, or route: update `current/project-state.md` and, if merge behavior changes, `flows/state-merge-and-artifacts.md`.
- Coding agents: also read root [`AGENTS.md`](../AGENTS.md) for implementation conventions.

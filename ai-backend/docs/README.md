# Documentation

This folder is the canonical home for human-readable project documentation.

It answers two questions:

1. **What is live in the code right now?** → [`current/`](current/)
2. **What is the target design and how was it built?** → [`architecture/`](architecture/) and [`learning/`](learning/)

When code and docs disagree, **trust the code** and update the docs.

---

## Start here (recommended reading order)

Read these in order if you are new to the swarm:

| # | Document | Why read it |
|---|----------|-------------|
| 1 | [current/how-the-swarm-graph-works.md](current/how-the-swarm-graph-works.md) | End-to-end story: parent graph, subgraphs, routing, artifacts |
| 2 | [flows/state-merge-and-artifacts.md](flows/state-merge-and-artifacts.md) | **Critical:** parent vs subgraph state, reducers, resets — avoids duplicate artifacts |
| 3 | [flows/swarm-graph-overview.md](flows/swarm-graph-overview.md) | Node-by-node topology, `Send` fan-out, module map |
| 4 | [current/project-state.md](current/project-state.md) | API routes, gaps, files that are not wired |
| 5 | [current/phase-11-postgres-persistence.md](current/phase-11-postgres-persistence.md) | Current Postgres checkpointer, app tables, and persistence logic |
| 6 | [architecture/plan.md](architecture/plan.md) | Target / roadmap (not guaranteed to match live code) |

**Deep dives (optional):**

- [flows/phase-7-flow.md](flows/phase-7-flow.md) — diagram workers, Mermaid lint loop
- [flows/phase-8-flow.md](flows/phase-8-flow.md) — document workers, disk paths, pairing

**Recent change:**

- [current/phase-11-postgres-persistence.md](current/phase-11-postgres-persistence.md) — Phase 11 Postgres checkpointing and app metadata tables
- [changes/2026-05-30-subgraph-artifact-merge-fix.md](changes/2026-05-30-subgraph-artifact-merge-fix.md) — fix for duplicate diagrams/docs in API responses

---

## Folder guide

| Path | Purpose |
|------|---------|
| [current/](current/) | Live system: how it works today, API, known gaps |
| [flows/](flows/) | Graph topology, merge semantics, phase-specific `Send` details |
| [changes/](changes/) | Changelogs for important behavioral fixes |
| [architecture/](architecture/) | Long-term target design ([plan.md](architecture/plan.md)) |
| [learning/](learning/) | Step-by-step build curriculum (pedagogical; may lag live code) |

---

## Documentation rules

- Keep **`current/`** and **`flows/state-merge-and-artifacts.md`** aligned with `app/agent/state/schema.py` and `app/agent/graphs/`.
- Keep **`architecture/`** as roadmap material unless the implementation matches.
- When you add a state field, graph node, or route: update `current/project-state.md` and, if merge behavior changes, `flows/state-merge-and-artifacts.md`.
- Coding agents: also read root [`AGENTS.md`](../AGENTS.md) for implementation conventions.

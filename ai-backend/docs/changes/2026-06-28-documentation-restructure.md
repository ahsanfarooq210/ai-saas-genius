# Change: Documentation restructure

**Date:** 2026-06-28

## Goal

Make the docs easier to read without deleting historical planning, flow, or change-log information.

## What changed

Added focused runtime sections:

- `docs/graphs/`
- `docs/persistence/`

Updated the main docs index so new readers have a clear path through runtime behavior, graph behavior, persistence behavior, API behavior, and deeper references.

## New graph docs

| File | Purpose |
|------|---------|
| `docs/graphs/overview.md` | how parent graph, subgraphs, service, API, checkpoints, and app tables work together |
| `docs/graphs/subgraph-state-transfer.md` | how subgraph outputs merge back into `GlobalSwarmState` |
| `docs/graphs/supervisor-graph.md` | parent graph loop, deterministic routing, reviewers, and iteration cap |
| `docs/graphs/architect-subgraph.md` | architecture drafting, complexity scoring, diagram fan-out/fan-in, artifacts |
| `docs/graphs/doc-generator-subgraph.md` | doc worker fan-out/fan-in, paired diagrams, doc artifacts |

## New persistence docs

| File | Purpose |
|------|---------|
| `docs/persistence/checkpointer-postgres-alembic.md` | how LangGraph checkpoints use external Postgres, and how Alembic manages only app tables |
| `docs/persistence/session-data-flow.md` | complete session save/read flow for blocking runs, streaming runs, resumes, artifacts, and debate logs |

## Preserved docs

The existing `current/`, `flows/`, `architecture/`, `learning/`, and `changes/` documents were kept. They now act as deeper references and historical records instead of the first reading path.

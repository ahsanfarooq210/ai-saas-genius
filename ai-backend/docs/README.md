# Backend documentation

This folder explains the backend as it exists in the live Python code. It is organized in three layers so a new reader does not need to jump between implementation notes and roadmap documents.

## Start here

The [`handbook/`](handbook/) is the learning path for someone who wants to understand and maintain the backend:

1. [Backend tour](handbook/01-backend-tour.md) — the layers, important folders, and startup path
2. [Request lifecycle](handbook/02-request-lifecycle.md) — one request from FastAPI to the LLM and back
3. [How the swarm works](handbook/03-how-the-swarm-works.md) — parent graph, subgraphs, agents, routing, and parallel workers
4. [State and data flow](handbook/04-state-and-data-flow.md) — shared state, reducers, subgraph boundaries, and revisions
5. [Database, checkpointer, and artifacts](handbook/05-database-checkpointer-and-artifacts.md) — what is stored where and why
6. [Streaming](handbook/06-streaming.md) — LangGraph events, normalization, SSE, completion, and failure behavior
7. [Authentication and ownership](handbook/07-authentication-and-ownership.md) — JWTs, cookies, middleware, dependencies, and session isolation
8. [API and session lifecycle](handbook/08-api-and-session-lifecycle.md) — endpoint purposes and run/resume/revise semantics
9. [Running and debugging](handbook/09-running-and-debugging.md) — configuration, startup, tests, and failure tracing

If you only read three documents, read the backend tour, how the swarm works, and database/checkpointer guide.

## Documentation map

| Area | Purpose | Status |
|---|---|---|
| [`handbook/`](handbook/) | Canonical, beginner-friendly explanation of the complete live backend | Start here |
| [`graphs/`](graphs/) | Precise graph topology and subgraph references | Live reference |
| [`persistence/`](persistence/) | Detailed persistence and checkpoint implementation notes | Live reference |
| [`current/`](current/) | Focused contracts for auth, streaming, revisions, and current feature state | Live reference |
| [`flows/`](flows/) | Deep dives into reducers, state merging, and older phase flows | Advanced notes |
| [`changes/`](changes/) | Dated implementation/change records and rollback context | Historical record |
| [`learning/`](learning/) | Build-order curricula; useful for study but not a statement of current behavior | Learning notes |
| [`architecture/`](architecture/) | Target architecture and roadmap ideas | Not proof of implementation |

## Source-of-truth rule

When documentation and code disagree, use this order:

1. live Python code
2. tests
3. root [`AGENTS.md`](../AGENTS.md)
4. live reference docs under `handbook/`, `current/`, `graphs/`, and `persistence/`
5. historical notes, roadmap documents, and the root README

The fastest live-code checks are:

- routes: `app/api/v1/router.py` and `app/api/v1/endpoints/`
- startup: `app/main.py`
- runtime orchestration: `app/services/swarm_graph_service.py`
- graph topology: `app/agent/graphs/`
- state: `app/agent/state/schema.py`
- database models: `app/models/`
- configuration: `app/core/config.py`

## Keeping the docs current

- Route changes: update the handbook API chapter and `app/api/v1/endpoints/README.md`.
- Graph or routing changes: update the swarm/state chapters and the relevant file under `graphs/`.
- State fields or reducers: update the state chapter and `flows/state-merge-and-artifacts.md`.
- Persistence or migration changes: update the database chapter and `persistence/`.
- Auth or ownership changes: update the auth chapter and `current/authentication.md`.
- Behavior changes worth preserving historically: add a dated note under `changes/`; do not use a change note as the primary explanation of current behavior.

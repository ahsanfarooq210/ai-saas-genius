# Persistence docs

This section explains how durable state works.

If you are new to the codebase, begin with the handbook's [Database, checkpointer, and artifacts](../handbook/05-database-checkpointer-and-artifacts.md). This folder contains the denser implementation reference.

Read in this order:

1. [checkpointer-postgres-alembic.md](checkpointer-postgres-alembic.md) - how LangGraph checkpoints use external Postgres, and how that coexists with Alembic-managed app tables.
2. [session-data-flow.md](session-data-flow.md) - complete flow for saving session rows, artifacts, debate logs, and final graph-state projection.

Short version:

- LangGraph checkpoint tables are for resumable graph execution.
- App tables are for user-facing result/session reads.
- Alembic owns app tables.
- `AsyncPostgresSaver.setup()` owns LangGraph checkpoint tables.
- `SwarmGraphService` bridges graph results into app tables after successful graph completion.
- `sessions.user_id` is the authorization boundary used before exposing checkpoint or session data.

# Backend handbook

This handbook is a guided explanation of the live backend for readers who did not write the code. It starts with mental models, then points to the exact implementation files.

## Suggested reading paths

**I want the big picture:**

1. [Backend tour](01-backend-tour.md)
2. [How the swarm works](03-how-the-swarm-works.md)
3. [Database, checkpointer, and artifacts](05-database-checkpointer-and-artifacts.md)

**I need to work on the frontend/API integration:**

1. [Authentication and ownership](07-authentication-and-ownership.md)
2. [API and session lifecycle](08-api-and-session-lifecycle.md)
3. [Streaming](06-streaming.md)

**I need to change graph behavior:**

1. [How the swarm works](03-how-the-swarm-works.md)
2. [State and data flow](04-state-and-data-flow.md)
3. [`../graphs/`](../graphs/)
4. [`../flows/state-merge-and-artifacts.md`](../flows/state-merge-and-artifacts.md)

**I need to operate or debug the backend:**

1. [Backend tour](01-backend-tour.md)
2. [Running and debugging](09-running-and-debugging.md)
3. [Database, checkpointer, and artifacts](05-database-checkpointer-and-artifacts.md)

## Vocabulary

| Term | Meaning in this repository |
|---|---|
| swarm | The complete LangGraph workflow that designs an architecture, creates artifacts, and reviews the result |
| agent/subagent | A node implementation with a focused role, usually containing its prompt and LLM call |
| parent graph | The supervisor graph that decides which phase runs next |
| subgraph | A compiled graph mounted as one node in the parent graph |
| state | The typed dictionary passed and updated as graph nodes run |
| thread | A `thread_id`-identified LangGraph execution history and app session |
| checkpoint | LangGraph's saved execution state for a thread |
| session | The app-owned durable projection used by frontend-facing session APIs |
| revision | A follow-up instruction and its result for an existing session |
| artifact | A Mermaid or Markdown file stored in Cloudinary and represented by metadata in state/database rows |

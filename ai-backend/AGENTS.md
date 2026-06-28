# AGENTS.md

## Purpose

This repository is a FastAPI backend for an architecture-design swarm built on LangGraph and LangChain. This file is the working contract for coding agents. Read it before making changes.

The codebase contains both runnable implementation and forward-looking architecture documents. Do not confuse roadmap material with live behavior. Agents should inspect the wired code first, then use the docs to extend it intentionally.

## Tech Stack

- Python
- FastAPI
- Pydantic v2 and `pydantic-settings`
- SQLAlchemy 2
- Alembic
- LangChain
- LangGraph
- `langchain-openai` via an OpenAI-compatible endpoint
- Pytest

## Runtime And Configuration

Primary config lives in [app/core/config.py](app/core/config.py).

Important settings:

- `DATABASE_URL`
- `OPENCODE_API_KEY`
- `OPENCODE_BASE_URL`
- `OPENCODE_MODEL`
- `OPENCODE_TEMPERATURE`
- `CLOUDINARY_*` settings for generated Mermaid/Markdown artifact storage
- `LANGGRAPH_POSTGRES_SSLMODE` for LangGraph Postgres checkpointer SSL behavior
- JWT settings for scaffolded auth code

LLM access is centralized in [app/core/llm.py](app/core/llm.py). Reuse that entry point instead of instantiating ad hoc clients.

## Repository Map

### App Shell

- [app/main.py](app/main.py): FastAPI app, lifespan, Postgres checkpointer setup, artifact-store setup, service registration
- [app/api/](app/api): HTTP dependency wiring and route registration
- [app/services/swarm_graph_service.py](app/services/swarm_graph_service.py): graph invocation, streaming, checkpoint reads, and app-table result persistence

### Agent Domain

- [app/agent/run.py](app/agent/run.py): thread config and checkpoint payload shaping
- [app/agent/streaming.py](app/agent/streaming.py): LangGraph stream event normalization and sanitization
- [app/agent/graphs/](app/agent/graphs): graph topology only
- [app/agent/state/schema.py](app/agent/state/schema.py): TypedDict state definitions
- [app/agent/subagents/](app/agent/subagents): node implementations, prompts, structured schemas
- [app/agent/tools/](app/agent/tools): non-LLM helpers such as Mermaid linting
- [app/agent/storage/](app/agent/storage): artifact-store abstraction and Cloudinary-backed file storage
- [docs/](docs): organized runtime, graph, persistence, flow, architecture, learning, and change docs

### Shared Infra

- [app/core/](app/core): settings, security, LLM client
- [app/db/](app/db): SQLAlchemy base/session management, Alembic filters, startup migration checks, LangGraph checkpointer setup
- [app/models/](app/models): ORM models
- [app/schemas/](app/schemas): API request/response models

## How To Find Live Behavior

Do not treat `AGENTS.md` as the source of truth for current routes, graph topology, or exact state shape. Those change in code.

Inspect these files first:

- [app/api/v1/router.py](app/api/v1/router.py): which endpoint modules are actually registered
- [app/api/v1/endpoints/](app/api/v1/endpoints): live HTTP handlers
- [app/main.py](app/main.py): app startup and service registration
- [app/services/swarm_graph_service.py](app/services/swarm_graph_service.py): graph invocation boundary, initial state, streaming, and app-table writes
- [app/agent/run.py](app/agent/run.py): thread config and checkpoint payload shaping
- [app/agent/graphs/](app/agent/graphs): actual graph wiring
- [app/agent/state/schema.py](app/agent/state/schema.py): actual shared state contract
- [docs/README.md](docs/README.md): current documentation reading order

## Source Of Truth Rules

Use this precedence order:

1. live Python code
2. tests
3. this `AGENTS.md`
4. architecture and project docs under `docs/`
5. README

The README still describes scaffolded auth endpoints that are not wired in the current API router. Do not assume README claims are implemented without checking imports and route registration.

## Coding Style

### General Python Style

- Use explicit type hints on public functions and methods
- Prefer small, single-purpose modules
- Keep functions direct and readable over clever
- Keep comments sparse and only when they explain intent or LangGraph constraints
- Match existing formatting and naming unless you are doing a deliberate repo-wide cleanup

### State And Graph Style

- Put graph topology in `app/agent/graphs/`
- Put prompts and node logic in `app/agent/subagents/`
- Put state definitions in `app/agent/state/schema.py`
- Put reusable helper tools in `app/agent/tools/`
- Keep routing logic in Python, not in prompts
- Node functions should return partial state updates, not mutate shared global objects
- Shared LangGraph state should stay `TypedDict`-based unless there is a deliberate architectural migration
- If the graph is request-driven, prefer compile-once service initialization over recompiling per request

### LLM Integration Style

- Reuse `get_chat_llm()`
- Prefer structured outputs with Pydantic models when the result shape matters
- Keep system prompts close to the subagent that owns them
- Normalize model output at the boundary before writing it into shared state

Existing examples:

- structured output: [app/agent/subagents/lead_architect.py](app/agent/subagents/lead_architect.py)
- output normalization: [app/agent/subagents/_schema.py](app/agent/subagents/_schema.py)
- text extraction helper: [app/agent/subagents/llm_reply.py](app/agent/subagents/llm_reply.py)

### API Layer Style

- Keep route handlers thin
- Validate inputs and outputs with Pydantic schemas
- Push graph orchestration into services and agent modules
- If a task is sync-only, keep the endpoint async and offload using `asyncio.to_thread(...)`

### Database Style

- Keep SQLAlchemy setup centralized in [app/db/session.py](app/db/session.py)
- Import ORM models through [app/db/base.py](app/db/base.py) for Alembic discovery
- Do not add database access inside graph nodes unless that is a conscious architecture change
- Keep LangGraph checkpoint tables owned by `AsyncPostgresSaver.setup()`. Alembic owns app tables only.

## Project-Specific Conventions

### 1. Separate Current Implementation From Roadmap

This repo intentionally contains future-phase design docs. When adding features:

- first inspect whether the runtime graph already supports them
- if not, implement them end to end instead of only adding docs or orphan files
- do not claim a feature exists because a planning doc mentions it
- treat routes, graph topology, and state shape as code-defined, not `AGENTS.md`-defined

### 2. Preserve Layer Boundaries

Follow this dependency direction:

- API -> services -> graph builder / compiled graph
- graphs -> subagents and state
- subagents -> core LLM helpers and schemas

Avoid reversing this. For example:

- graph files should not own prompts
- API files should not build prompts
- schemas should not import FastAPI request objects

### 3. Keep Subagents Cohesive

Each subagent module should own one role:

- prompt
- structured output schema usage
- node method or function
- minimal normalization required for state writes

Do not create god-modules that mix multiple agent roles.

### 4. Use Deterministic Routing

Routing functions must read state and return next-step names. They should not call the LLM. The live deterministic router is [app/agent/subagents/supervisor_router.py](app/agent/subagents/supervisor_router.py).

### 5. Add State Fields Carefully

When adding a state field, update all places that must agree:

1. `GlobalSwarmState`
2. empty initial state in `SwarmGraphService`
3. response schemas if the API returns it
4. app-table persistence and Alembic migrations if `/sessions/{thread_id}` should return it
5. tests that assert state shape, reducer behavior, or session response shape

### 6. Prefer Narrow, Explicit Plans

If you implement a new swarm phase, wire the smallest end-to-end slice that works:

- state
- subagent
- graph edge
- API exposure if needed
- tests

Avoid leaving disconnected files unless they are explicit stubs with a clear purpose.

## Naming Notes

The repository has a few inconsistent names. Do not casually “fix” them in passing because imports depend on them.

Notable examples:

- `comlexity_analyzer.py` is misspelled but currently imported under that name
- `auth-repository.py` uses a hyphen, which is unusual for Python modules

If you rename either, do it as a coordinated change with import updates and verification.

## Testing Expectations

Run targeted tests for the code you touch. Use `pytest`.

Useful focused suites:

- [tests/test_reducer_phase6.py](tests/test_reducer_phase6.py)
- [tests/test_reducer_phase8.py](tests/test_reducer_phase8.py)
- [tests/test_subgraph_artifact_accumulation.py](tests/test_subgraph_artifact_accumulation.py)
- [tests/test_supervisor_routing_phase9.py](tests/test_supervisor_routing_phase9.py)
- [tests/test_swarm_graph_service_phase11.py](tests/test_swarm_graph_service_phase11.py)
- [tests/test_swarm_graph_service_streaming.py](tests/test_swarm_graph_service_streaming.py)
- [tests/test_swarm_streaming_events.py](tests/test_swarm_streaming_events.py)
- [tests/test_checkpoint_payload.py](tests/test_checkpoint_payload.py)
- [tests/test_alembic_phase11.py](tests/test_alembic_phase11.py)

When adding graph fan-out, reducers, or state fields, add tests around:

- reducer merge behavior
- graph output shape
- routing decisions
- schema validation for LLM outputs
- session persistence and response shape when app-table result data changes

## How To Extend The System

### Add A New Graph Node

1. implement the node in the relevant subagent module
2. define or update any state fields it reads or writes
3. wire it in the correct graph file
4. update service initialization or API schema if externally visible
5. add tests for the new state transition

### Add Parallel Workers

When implementing `Send`-based fan-out:

- give workers isolated worker-state types
- annotate reducer fields with `operator.add` on **subgraph** state (`ArchitectGraphState`, `DocGraphState`), not on parent `GlobalSwarmState` artifact fields
- keep parent `GlobalSwarmState.generated_diagrams` and `generated_docs` as plain lists so completed subgraph outputs replace previous artifacts instead of appending duplicates
- keep `debate_logs` plain unless there is a deliberate graph-wide reducer design; reviewer nodes currently write normal state updates
- make each worker return only its artifact payload (one-item list slice)
- use `prepare_*_artifacts_node` at subgraph START when a generation phase may rerun
- test subgraph boundary merge with `tests/test_subgraph_artifact_accumulation.py` and reducer hints in `tests/test_reducer_phase6.py` / `test_reducer_phase8.py`

See [docs/graphs/subgraph-state-transfer.md](docs/graphs/subgraph-state-transfer.md) and [docs/flows/state-merge-and-artifacts.md](docs/flows/state-merge-and-artifacts.md).

### Add New API Endpoints

- define request and response schemas under `app/schemas/`
- keep endpoint logic thin
- register the route in `app/api/v1/router.py`
- inject dependencies through `app/api/deps.py` where appropriate

## Known Gaps And Non-Goals

These areas exist in code or docs but are not complete runtime features today:

- deep-dive and summarize execution in the active graph
- complete auth API despite README references
- human-feedback interrupts

Do not build on assumptions that these are already functional.

## Agent Checklist Before Editing

Before changing code:

1. identify whether you are modifying live behavior or roadmap scaffolding
2. inspect the graph, router, or service file that actually wires the behavior
3. inspect the relevant state schema and API schema
4. check whether startup or dependency wiring also needs updates
5. update `docs/` when graph, persistence, streaming, or API behavior changes
6. run the smallest meaningful test or verification command afterward

## Safe Defaults For Future Agents

- Prefer `AGENTS.md` guidance over stale README claims
- Preserve current architecture unless the task explicitly expands it
- Keep the graph compile-once model
- Keep route handlers thin
- Keep prompts out of graph topology files
- Use [docs/README.md](docs/README.md) as the current docs reading order
- Use structured output for machine-consumed LLM data
- Treat roadmap docs as design input, not proof of implementation

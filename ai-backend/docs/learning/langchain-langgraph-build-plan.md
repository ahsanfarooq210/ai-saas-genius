# LangGraph Architecture Swarm — Definitive Progressive Build Plan

> **Live system:** For current graph behavior and state merge rules, read [how-the-swarm-graph-works.md](../current/how-the-swarm-graph-works.md) and [state-merge-and-artifacts.md](../flows/state-merge-and-artifacts.md). This build plan is educational; some state examples below predate subgraph-local reducers.
>
> **Goal**: Build an autonomous multi-agent swarm where a user submits a system design
> requirement (e.g. "Design a globally distributed URL shortener") and the swarm produces:
>
> - **One `.mmd` Mermaid file per architecture component** + overview + optional cross-cutting diagrams
> - **One `.md` Markdown file per architecture component** + `overview.md` + optional ADRs/runbooks
> - **Two adversarial reviewer passes** (Scalability Expert + Security Auditor)
> - **A feedback loop** until both reviewers APPROVE or a 5-iteration circuit breaker fires
>
> **Philosophy**: You add state fields, nodes, and sub-graphs only when the current phase
> genuinely needs them. Nothing is written in advance. You learn by building the real product —
> every line of code produced in every phase stays in the final system.

---

## How to Use This Plan

1. Complete phases in order. Do not skip unless marked optional.
2. After each phase, **stop and run** the graph until the acceptance criteria pass.
3. Keep a short lab notebook: what you learned, what broke, what LangGraph API fixed it.
4. When you need final field names or topology details, [`plan.md`](../architecture/plan.md) under `docs/architecture/` is the canonical reference — but **only pull forward what the current phase allows**.

### Repository layout (this codebase)

All paths are relative to **`ai-backend/`** (the directory that contains `app/` and `alembic/`). Run the API and CLI with your working directory set to **`ai-backend/`** so imports like `app.agent...` resolve (use `pip install -e .` or `PYTHONPATH=.` as your project prefers).

```
ai-backend/
├── alembic/                         # Postgres migrations (exclude langgraph schema in env.py)
├── tests/                           # e.g. test_reducer Phase 6
└── app/
    ├── main.py                      # Phase 12 — FastAPI app, lifespan, graph compile
    ├── core/                        # settings — extend config.py / env vars (Phase 11–12)
    ├── db/
    │   ├── engine.py
    │   ├── models.py
    │   ├── checkpointer.py          # AsyncPostgresSaver (Phase 11)
    │   └── deps.py
    ├── api/
    │   └── v1/
    │       ├── router.py           # register swarm routes (Phase 12)
    │       └── endpoints/
    │           └── swarm.py       # POST /start, GET /stream/{id}, POST /human-feedback
    └── agent/                       # ← LangGraph swarm package (below)
        └── docs/                    # planning — see docs/README.md
```

**Everything in the progressive plan that is “inside the swarm” lives under **`app/agent/`** — this folder already has `state/`, `subagents/`, `nodes/`, `tools/` (stub). You add **`graphs/`** (compiled `StateGraph` wiring), fill **`state/schema.py`**, and optionally **`storage/`** *or* use **`app/services/`** for `FileStore` — this document pins one consistent choice.**

---

## Final System Architecture (your destination)

```
START → supervisor_node → [conditional edge] → architect_graph      → supervisor_node
                                              → doc_generator_graph  → supervisor_node
                                              → scalability_node     → supervisor_node
                                              → security_node        → supervisor_node
                                              → END
```

**Sub-graphs** (compiled independently, added as a single opaque node in the parent):
- `architect_graph` — Lead Architect + Complexity Analyzer + parallel Diagram Generator workers
- `doc_generator_graph` — Doc Planner + parallel Document Generator workers

**Plain nodes** in the parent graph:
- `supervisor_node` — routes only, never generates content
- `scalability_node` — adversarial reviewer, writes APPROVED or REJECTED
- `security_node` — adversarial reviewer, writes APPROVED or REJECTED

---

## Concept → Phase Map

| LangGraph / Swarm Concept | Introduced In |
|---|---|
| `StateGraph`, `START`, compiled graph, `invoke` | Phase 1 |
| Multiple nodes, sequential edges, cross-node state reading | Phase 2 |
| Conditional edges, routing functions | Phase 3 |
| Checkpointer, `thread_id`, resume / replay | Phase 4 |
| Sub-graphs — child graph as single node in parent | Phase 5 |
| `Annotated[list, operator.add]` reducers | Phase 6 |
| `Send` API, map–reduce, parallel diagram workers | Phase 7 |
| Doc sub-graph, Document Generator workers, file store | Phase 8 |
| Parent supervisor loop, full orchestration shape | Phase 9 |
| Scalability + Security reviewers, rejection loops, iteration cap | Phase 10 |
| Postgres checkpointer, schema isolation, Alembic filter | Phase 11 |
| FastAPI, SSE streaming, production hardening | Phase 12 |

---

## Subagent Roster (who does what)

A **subagent** is a named role with its own system prompt, inputs, and outputs — implemented
as one or more LangGraph nodes. Sub-graphs bundle several subagents; the parent graph sees
only the bundle.

| Subagent | Where it lives | Model | Reads | Writes |
|---|---|---|---|---|
| **Supervisor Router** | Parent — `supervisor_node` | small | Full `GlobalSwarmState` | Routing only; increments `iteration_count` |
| **Lead Architect** | Architect sub-graph — draft node | capable | `task_requirement` | `architecture_json`, `component_list` |
| **Complexity Analyzer** | Architect sub-graph | small | `architecture_json`, `component_list` | `complexity_score`, `diagram_plan`, `doc_plan` |
| **Diagram Planner** | Architect sub-graph | small / code | `diagram_plan` | `list[Send]` for diagram workers |
| **Diagram Generator** (worker) | Architect sub-graph — one per `Send` | capable | `DiagramWorkerState` + linter tool | One `DiagramEntry` → `generated_diagrams` |
| **Mermaid Linter** | Tool (not LLM) | — | Mermaid string | Parse errors for repair loop |
| **Doc Planner** | Doc sub-graph | small | `component_list`, `generated_diagrams` | `list[Send]` for doc workers |
| **Document Generator** (worker) | Doc sub-graph — one per `Send` | capable | `DocWorkerState` + all diagrams | One `DocEntry` → `generated_docs`; saves file |
| **Scalability Expert** | Parent — plain node | capable | All diagrams + docs + `architecture_json` | `scalability_feedback` |
| **Security Auditor** | Parent — plain node | capable | Same as scalability | `security_feedback` |

---

## Component-Centric Artifact Model (the product invariant)

Every run must produce **paired artifacts anchored to `component_list`**:

| For each component `C` with stable slug | Mermaid | Markdown |
|---|---|---|
| Dedicated pair | `iter{n}_{slug}.mmd` | `{slug}.md` |

On top of that baseline:

| Always | `overview.mmd` + `overview.md` |
|---|---|
| High complexity (score 7–10) | Extra diagrams: `auth-flow`, `db-schema`, `infra`, etc. Extra docs: `adr-*.md`, `runbook-*.md` |

**`component_slug`** is the linking key. Both `DiagramEntry` and `DocEntry` carry it.
File keys follow the same slug so the frontend can group paired artifacts:
`diagrams/{thread_id}/iter{n}_{slug}.mmd` ↔ `reports/{thread_id}/{slug}.md`.

---

## Recommended File Layout (set up in Phase 0, filled phase by phase)

Swarm-specific code stays under **`app/agent/`**. App shell (FastAPI root, HTTP routes, Alembic, shared DB) uses the existing **`app/`** and **`ai-backend/alembic/`** trees.

```
app/agent/
├── docs/                            ← planning & reference (not runtime code)
│   ├── architecture/plan.md
│   ├── learning/                    ← incremental + progressive build plans
│   └── flows/                       ← phase-specific Mermaid flows
├── __init__.py                      ← Phase 0 — package marker (needed for python -m app.agent.run)
├── llm.py                           ← thin chat client wrapper (Phase 0)
├── run.py                           ← Phase 1+ CLI harness: python -m app.agent.run …
├── graphs/
│   ├── __init__.py
│   ├── supervisor_graph.py         ← parent graph topology (Phase 9)
│   ├── architect_graph.py          ← architect sub-graph (Phase 5+)
│   └── doc_generator_graph.py      ← doc sub-graph (Phase 8)
│
├── state/
│   └── schema.py                    ← ALL TypedDicts — grows phase by phase (rename from stub if empty)
│
├── subagents/                       ← ONE FILE PER ROLE (prompts + schemas + callable)
│   ├── supervisor_router.py
│   ├── lead_architect.py
│   ├── complexity_analyzer.py
│   ├── diagram_planner.py
│   ├── diagram_generator_worker.py
│   ├── doc_planner.py
│   ├── document_generator_worker.py
│   ├── scalability_expert.py
│   └── security_auditor.py
│
├── nodes/                           ← optional thin wrappers calling into subagents/
├── tools/
│   └── mermaid_linter.py
└── storage/                         ← create in Phase 8 if you prefer colocation …
    └── file_store.py                ← …otherwise implement under app/services/file_store.py

# Shared app layer (outside app/agent/)

app/main.py                           # Phase 12 — lifespan, compiled graph on app.state
app/core/config.py                   # Phase 11+ — extend for DB URL, tracing keys
app/db/                              # Phase 11 — engine, SQLAlchemy models, checkpointer helper, deps
app/api/v1/router.py                  # Phase 12 — include swarm endpoints
app/api/v1/endpoints/swarm.py         # Phase 12 — SSE + start + human-feedback

ai-backend/alembic/                   # Phase 11 — migrations; env.py excludes langgraph schema
ai-backend/tests/                     # Phase 6 — e.g. test_reducer_phase6.py
```

**Three layers inside the swarm package:**

| Layer | Location | Responsibility |
|---|---|---|
| **Graph topology** | `app/agent/graphs/` | Wiring only; import callables from `subagents/`; no prose prompts |
| **State schema** | `app/agent/state/schema.py` | TypedDicts only; no business logic |
| **Node implementations** | `app/agent/subagents/` (+ optional `nodes/`) | Prompts, Pydantic schemas, LLM calls |

Sub-graph files are **topology only**. Prompts never live in `graphs/*.py`.

**Imports (example Phase 9):**

```python
from app.agent.graphs.architect_graph import architect_graph  # compiled sub-graph
from app.agent.state.schema import GlobalSwarmState
```

---

## Phase 0 — Project Skeleton

> **Core concept**: three-layer separation, naming discipline, import structure

### What you build

Create the full directory layout above with **empty modules**. Each file gets a docstring
stating which phase fills it and what its responsibility is. No logic yet.

```
app/agent/state/schema.py            ← docstring: "TypedDicts — grows phase by phase."
app/agent/graphs/supervisor_graph.py ← docstring: "Parent topology. Phase 9."
app/agent/graphs/architect_graph.py  ← docstring: "Architect sub-graph. Phase 5."
app/agent/graphs/doc_generator_graph.py
app/agent/subagents/lead_architect.py ← docstring: "Lead Architect role. Phase 5."
... (one stub per subagent in the roster above)
```

Add **`app/agent/graphs/__init__.py`** and **`app/agent/storage/`** only if you use colocated storage; **`app/agent/llm.py`** — thin wrapper around your chat model client that both small
and capable model tiers can be swapped in one place.

### What state you add

None yet.

### What you learn

- The three layers: topology lives in `app/agent/graphs/`, schemas in `app/agent/state/schema.py`, implementations in `app/agent/subagents/`
- Why prompts must never live in graph files — you will thank yourself in Phase 9 when you
  need to swap a reviewer prompt without touching the graph wiring
- Naming discipline: use final names from the architecture document now (`GlobalSwarmState`,
  `task_requirement`, `generated_diagrams`, etc.) to avoid rename churn later

### Acceptance criteria

```bash
cd ai-backend
python -c "from app.agent.state import schema as s; print('imports clean:', s.__name__)"
# No circular imports, no errors (requires PYTHONPATH or editable install)
```

You can state in one sentence: **nodes return partial state updates; the graph merges them.**

---

## Phase 1 — One Node, One State, One Invocation

> **Core concept**: `StateGraph`, nodes, edges, `START`, `END`, state as a dict,
> how nodes receive full state but return only a partial update

### What you build

```
app/agent/state/schema.py   ← first two fields
app/agent/run.py            ← Phase 1+ — python -m app.agent.run "Design a URL shortener"
```

### What state you add

The absolute minimum. Two fields. Resist the urge to add more.

```python
# app/agent/state/schema.py
from typing import TypedDict

class GlobalSwarmState(TypedDict):
    task_requirement: str     # the user's prompt — never mutated after init
    architecture_draft: str   # plain text — placeholder until Phase 2
```

Use the final name `GlobalSwarmState` now. It costs nothing and saves a rename later.

### Graph shape

```
START → draft_architecture_node → END
```

`draft_architecture_node` lives in `subagents/lead_architect.py`. For Phase 1 it
just prints the requirement and returns `{"architecture_draft": "stub text"}`.
No LLM call yet.

### What you learn

- How `StateGraph(GlobalSwarmState)` is defined and `.compile()`d
- What `.invoke({"task_requirement": "..."})` returns — a plain dict
- How nodes receive the **full state** but return only the **keys they changed**
  (LangGraph merges, not replaces — this is the single most important mechanic to internalize)
- Why every field needs a default value or must be provided at invocation time

### Acceptance criteria

```bash
cd ai-backend
python -m app.agent.run "Design a URL shortener"
# Output: {"task_requirement": "Design a URL shortener", "architecture_draft": "stub text"}
# Run twice — state keys are always stable even if LLM content differs
```

---

## Phase 2 — Linear Multi-Step Pipeline

> **Core concept**: chaining nodes, sequential edges, how each node reads what the
> previous node wrote, structured output with Pydantic, LangSmith tracing

### What you build

```
app/agent/state/schema.py   ← extend TypedDicts
app/agent/subagents/
│   ├── lead_architect.py   ← real GPT-4o call, structured output
│   └── complexity_analyzer.py ← real call, returns score + plans
ai-backend/.env             ← OPENAI_API_KEY, LANGCHAIN_TRACING_V2, LANGCHAIN_API_KEY (or app/core)
```

### What state you add

```python
class GlobalSwarmState(TypedDict):
    task_requirement: str
    architecture_draft: str     # now a real LLM output

    # NEW
    architecture_json: dict     # structured component map: {component: {description, relations}}
    component_list: list[str]   # ["API Gateway", "Auth Service", "Cache", "DB"]
    complexity_score: int       # 1–10; drives how many files the swarm produces
    diagram_plan: list[str]     # ["overview", "component-api-gateway", "auth-flow", ...]
    doc_plan: list[str]         # ["overview.md", "api-gateway.md", "auth-service.md", ...]
```

### Graph shape

```
START → draft_architecture_node → extract_components_node → score_complexity_node → END
```

### Scoring guide the complexity analyzer follows

- Score 1–3: simple/monolith → 1 diagram (`overview`) + 1–2 docs
- Score 4–6: microservices → 3–4 diagrams + 3–5 docs
- Score 7–10: distributed → 5–10 diagrams + 6–12 docs

`diagram_plan` entries follow a controlled vocabulary for cross-cutting diagrams:
`overview`, `auth-flow`, `db-schema`, `infra`, `data-pipeline`, `api-contracts`,
`event-flow`, `deployment`. For component-specific diagrams: `component-{slug}`.
`doc_plan` entries are slugified filenames: `overview.md`, `{slug}.md`, `adr-{title}.md`.

### What you learn

- How `.with_structured_output(PydanticModel)` enforces the LLM's response shape
- Why you validate LLM output *before* writing to state
- How LangSmith tracing works — every run shows the exact prompt, response, and latency

### Acceptance criteria

```bash
cd ai-backend && python -m app.agent.run "Design a URL shortener"
# complexity_score: 2–3
# component_list: 4–6 real named components
# diagram_plan: ["overview", "component-url-encoder", "component-redirect-service"]
# LangSmith dashboard: 3 nodes, 2–3 LLM calls, full trace

python -m app.agent.run "Design a distributed multi-tenant SaaS with real-time analytics"
# complexity_score: 8–9
# diagram_plan: 6+ items including per-component entries
```

---

## Phase 3 — Conditional Routing (Mini-Supervisor)

> **Core concept**: conditional edges, routing functions, why control flow lives in
> Python not in prompts, rehearsal for the full supervisor

### What you build

```
app/agent/state/schema.py          ← add deep_dive_notes
app/agent/subagents/supervisor_router.py  ← routing logic only
```

### What state you add

```python
class GlobalSwarmState(TypedDict):
    ...previous fields...

    # NEW — control flow (first two of several that will appear)
    deep_dive_notes: str    # extra constraints when complexity is high; default ""
```

### Graph shape

```
START → draft_architecture_node → extract_components_node → score_complexity_node
      → supervisor_node → [conditional] → deep_dive_node → summarize_node → END
                                        → summarize_node → END
```

Routing rule: `complexity_score >= 7` → `deep_dive_node`, else skip straight to `summarize_node`.

Write the routing function in **`app/agent/subagents/supervisor_router.py`**:

```python
def route_after_complexity(state: GlobalSwarmState) -> str:
    if state["complexity_score"] >= 7:
        return "deep_dive"
    return "summarize"
```

**This is a rehearsal.** The full `supervisor_route` in Phase 9 follows the exact same
pattern — just with more branches. Write this one cleanly so the pattern is in your fingers.

### What you learn

- How `add_conditional_edges(node, routing_fn, {"deep_dive": ..., "summarize": ...})` works
- Why routing functions must be **cheap and deterministic** — read state only, no LLM calls
- Why business rules live in **Python** (routing fn) not in prompts — Python owns control flow

### Acceptance criteria

```bash
cd ai-backend && python -m app.agent.run "Design a URL shortener"
# complexity_score 2–3 → deep_dive_node NOT visited → goes straight to summarize

python -m app.agent.run "Design a distributed SaaS platform with real-time analytics and ML pipeline"
# complexity_score 8+ → deep_dive_node IS visited
```

---

## Phase 4 — Checkpointer, `thread_id`, Resume

> **Core concept**: where state lives between runs, `thread_id` as conversation identity,
> resuming after a process restart, the in-memory vs persistent checkpointer contrast

### What you build

```
app/agent/run.py   ← add --thread-id flag and --resume flag
```

No new state fields. This phase is entirely about **where state is stored**, not what is in it.

### What state you add

None. You are learning the storage layer, not the schema.

### Steps

1. Compile the Phase 3 graph with `MemorySaver`:
   ```python
   from langgraph.checkpoint.memory import MemorySaver
   graph = builder.compile(checkpointer=MemorySaver())
   ```

2. Pass `config={"configurable": {"thread_id": "abc-123"}}` on every `.invoke()` call.

3. Call `graph.get_state(config)` after a run — inspect the checkpoint snapshot.

4. Run with one `thread_id`, then call `.invoke()` again on the same thread with a
   new `user_clarification` field merged in — observe that previous state is preserved.

5. Kill the process. Restart. Try to resume. Observe that `MemorySaver` loses everything.
   **Write this observation in your lab notebook.** This motivates `AsyncPostgresSaver` in Phase 11.

### What you learn

- How LangGraph serializes and stores full graph state after every single node
- How `thread_id` identifies a conversation — same ID = same state lineage
- The hard difference between `MemorySaver` (in-process, dies with the process) and
  `AsyncPostgresSaver` (survives restarts) — you feel this gap by experiencing the data loss
- Why you do not touch Postgres yet — delay complexity until Phase 11

### Acceptance criteria

```bash
cd ai-backend && python -m app.agent.run "Design a URL shortener" --thread-id abc-123
# First run completes

python -m app.agent.run --resume --thread-id abc-123
# Second run picks up from last checkpoint (MemorySaver — same process only)

# Kill process, restart, try resume
# Expected: MemorySaver has lost state — you must start fresh
# Lab note: "MemorySaver is ephemeral. Postgres is needed for production."
```

---

## Phase 5 — First Sub-Graph: Architect v0 (Sequential)

> **Core concept**: compiling a child `StateGraph` independently, registering it as a
> single opaque node in a parent graph, internal state vs global state, state handoff contract

### What you build

```
app/agent/state/schema.py      ← add ArchitectInternalState (or document in comments if using Option A only)
app/agent/graphs/
│   ├── architect_graph.py     ← compiled sub-graph (topology only)
│   └── supervisor_graph.py    ← parent graph: START → architect_graph → END for now
app/agent/subagents/
    ├── lead_architect.py       ← real GPT-4o call
    └── complexity_analyzer.py  ← real call
```

### What state you add

Two TypedDicts this phase. One grows `GlobalSwarmState`. The other is **internal** —
the parent graph never sees it.

```python
# app/agent/state/schema.py additions

class ArchitectInternalState(TypedDict):
    # Lives ONLY inside architect_graph — never surfaces to GlobalSwarmState
    draft_mermaid: str              # scratchpad during Mermaid generation
    linter_errors: list[str]        # feedback between linter and generator
    internal_loop_count: int        # lint-fix retry counter; hard limit = 3
    current_diagram_type: str       # which diagram is being worked on right now

# GlobalSwarmState — add the overview Mermaid now that architect produces it
# (complexity_score, diagram_plan, doc_plan already exist from Phase 2)
# NEW field:
#   current_architecture_mermaid: str   # primary overview diagram string
```

**The lesson here**: `linter_errors` and `draft_mermaid` are architect internals — they
live in `ArchitectInternalState`, not in `GlobalSwarmState`. The parent has zero visibility
into the lint-fix loop inside. You feel what "isolation" means.

> **LangGraph subgraph state typing — implementation note**
>
> LangGraph supports two sub-graph patterns. Know which one you are using before you write code:
>
> **Option A — shared schema (simplest)**: the child graph uses the *same* `GlobalSwarmState`.
> All parent fields are visible inside. You get isolation by discipline (nodes only touch their
> own fields), not by the type system. This is the easiest pattern to start with and what most
> tutorials show.
>
> **Option B — separate schema + input/output mappers**: the child graph uses its own TypedDict
> (e.g. `ArchitectInternalState`). LangGraph requires you to provide `input` and `output` mapping
> functions (or a combined `ArchitectState` that is a superset) so the framework knows how to
> translate state at the boundary. Without the mappers the graph raises a `KeyError` at runtime.
>
> The pedagogical story in this plan (internal fields invisible to the parent) is correct for
> both options. **For Phase 5, start with Option A** — use `GlobalSwarmState` in the child,
> rely on discipline to keep internal scratch fields out of the global schema, and simply do not
> add `draft_mermaid` / `linter_errors` to `GlobalSwarmState`. This avoids framework complexity
> while you are still learning sub-graph basics.
>
> Revisit Option B in Phase 12 if you want strict type-level isolation. Check the LangGraph
> docs for your installed version (`langgraph.__version__`) for the exact mapper API — it has
> changed across minor releases.

### What the sub-graph does internally (sequential for now, no Send yet)

```
draft_node → lint_overview_node → write_state_node → END
```

`draft_node` calls **`subagents/lead_architect.py`** → produces `current_architecture_mermaid` and `architecture_json`.
`lint_overview_node` validates Mermaid syntax and loops up to 3 times on failure.
`write_state_node` returns only the fields `GlobalSwarmState` needs.

### State handoff contract

Each agent writes only the fields it owns. This contract is established now and never violated.

| Agent | Fields it writes to `GlobalSwarmState` |
|---|---|
| `architect_graph` | `current_architecture_mermaid`, `architecture_json`, `component_list`, `complexity_score`, `diagram_plan`, `doc_plan` |
| `doc_generator_graph` (Phase 8) | `generated_docs`, `docs_complete` |
| `scalability_node` (Phase 10) | `scalability_feedback` |
| `security_node` (Phase 10) | `security_feedback` |
| `supervisor_node` (Phase 9) | `iteration_count`, `next_agent` |

### How to register a sub-graph in the parent

```python
# app/agent/graphs/supervisor_graph.py
from app.agent.graphs.architect_graph import architect_graph   # already compiled

parent = StateGraph(GlobalSwarmState)
parent.add_node("architect_graph", architect_graph)  # sub-graph = single opaque node
parent.add_node("supervisor_node", supervisor_fn)
```

### Acceptance criteria

```bash
cd ai-backend && python -m app.agent.run "Design a URL shortener"
# current_architecture_mermaid: valid Mermaid flowchart string
# Parent graph code does NOT know inner node names — only "architect_graph"
# GlobalSwarmState does NOT contain linter_errors or draft_mermaid
```

---

## Phase 6 — Reducers: `Annotated[list, operator.add]`

> **Core concept**: why plain list breaks parallel writes, how `operator.add` fixes it,
> the single most important annotation in the swarm

### What you build

No new graph nodes. No LLM calls. A focused experiment in `app/agent/state/schema.py` and a
short test under **`ai-backend/tests/`**.

```
app/agent/state/schema.py   ← add DiagramEntry, update GlobalSwarmState
tests/test_reducer_phase6.py  ← proves the concept with two sequential append nodes
```

### What state you add

```python
# app/agent/state/schema.py additions
from typing import Annotated
import operator

class DiagramEntry(TypedDict):
    diagram_type: str       # "overview" | "component-api-gateway" | "auth-flow" | ...
    component_slug: str     # slug of the component this diagram is scoped to,
                            # or "" for purely cross-cutting diagrams like "auth-flow"
    content: str            # raw Mermaid string
    path: str               # file key: diagrams/{thread_id}/iter{n}_{diagram_type}.mmd
    iteration: int          # which swarm pass produced this

# GlobalSwarmState addition:
#   generated_diagrams: Annotated[list[DiagramEntry], operator.add]
#
# This annotation means:
#   when multiple nodes each return {"generated_diagrams": [one_entry]},
#   LangGraph APPENDS the entries instead of the last writer overwriting all others.
```

### The experiment you must run

**Step 1**: Use `list[DiagramEntry]` (no annotation). Build a tiny test graph with two
sequential nodes that each return `{"generated_diagrams": [fake_entry]}`. Run it.
Check `len(state["generated_diagrams"])`. It will be **1** — the second node overwrote the first.

**Step 2**: Change to `Annotated[list[DiagramEntry], operator.add]`. Run again.
Check the length. It will be **2**.

You will never forget why this annotation exists after seeing it fail without it.

### What you learn

- `Annotated[list, operator.add]` is mandatory for any field that receives parallel writes
- Each node should return **only the new slice** — `{"generated_diagrams": [new_entry]}` —
  not the whole accumulated list; `operator.add` handles the merging
- Without this annotation, you lose diagrams **silently** — no error, just missing data

### Acceptance criteria

```bash
cd ai-backend && pytest tests/test_reducer_phase6.py -v
# Without annotation: length = 1 (last writer wins)
# With annotation: length = 2 (both entries preserved)
# Print both results side by side to make the lesson concrete
```

---

## Phase 7 — Map-Reduce with `Send`: Parallel Diagram Workers

> **Core concept**: dynamic fan-out when N is unknown at compile time, `Send` API,
> isolated worker state, reduce phase after all workers finish

### What you build

```
app/agent/state/schema.py           ← add DiagramWorkerState
app/agent/graphs/architect_graph.py ← diagram_planner_node returns list[Send]
app/agent/subagents/
    ├── diagram_planner.py
    └── diagram_generator_worker.py
```

### What state you add

Add to **`app/agent/state/schema.py`**:

```python
class DiagramWorkerState(TypedDict):
    # Each parallel Send() invocation gets its OWN isolated copy — workers cannot see each other
    diagram_type: str               # "overview" | "component-api-gateway" | "auth-flow"
    component_slug: str             # matches the component this worker is scoped to, or ""
    task_requirement: str           # passed down from GlobalSwarmState
    architecture_json: dict         # full context so the worker generates accurately
    draft_mermaid: str              # scratchpad
    linter_errors: list[str]        # local to this worker
    internal_loop_count: int        # max 3
    thread_id: str                  # for file key construction
    iteration: int                  # current swarm pass number
```

### What diagram_planner_node returns

```python
# app/agent/subagents/diagram_planner.py
from langgraph.types import Send

def diagram_planner_node(state: GlobalSwarmState) -> list[Send]:
    # Returns list[Send] — NOT a state dict — this triggers the parallel fan-out
    return [
        Send("diagram_generator_node", DiagramWorkerState(
            diagram_type=entry,
            component_slug=slug_from(entry),   # extract slug if component-scoped
            task_requirement=state["task_requirement"],
            architecture_json=state["architecture_json"],
            draft_mermaid="",
            linter_errors=[],
            internal_loop_count=0,
            thread_id=state.get("thread_id", ""),
            iteration=state["iteration_count"],
        ))
        for entry in state["diagram_plan"]
    ]
```

### Output files produced

```
output/{thread_id}/iter1_overview.mmd
output/{thread_id}/iter1_component-api-gateway.mmd
output/{thread_id}/iter1_component-auth-service.mmd
output/{thread_id}/iter1_auth-flow.mmd
```

One `.mmd` file per `diagram_plan` entry. Component-scoped diagrams have a matching
`component_slug` that will pair with a `.md` file of the same slug in Phase 8.

### Graph shape inside architect_graph (updated)

```
draft_node → complexity_analyzer_node → diagram_planner_node
           → [Send × N] → diagram_generator_node (parallel, each with lint-fix loop)
                        → reduce_diagrams_node → write_state_node → END
```

### What you learn

- How `Send(node_name, isolated_state)` triggers a parallel invocation
- Why `diagram_planner_node` returns `list[Send]`, not a state dict
- How the reduce node runs only **after all parallel workers complete** (LangGraph handles sync)
- The difference between shared state (`GlobalSwarmState`) and worker-local (`DiagramWorkerState`)
- For a `component_list` of length K: you should see K component-scoped diagram entries
  plus overview (and optional extras) in `generated_diagrams`

### Acceptance criteria

```bash
cd ai-backend && python -m app.agent.run "Design a URL shortener"
# component_list has K components
# generated_diagrams has K + 1 entries (one per component + overview)
# Each entry has a .mmd file written to output/

python -m app.agent.run "Design a distributed payment system"
# 7+ components → 8+ diagram entries including overview
# Open LangSmith: parallel node executions visible side by side in the trace
```

---

## Phase 8 — Doc Sub-Graph: Parallel Markdown Workers

> **Core concept**: applying Send a second time, cross-agent state reading, the
> `component_slug` pairing invariant, `docs_complete` handoff signal

### What you build

```
app/agent/state/schema.py               ← add DocEntry, DocWorkerState
app/agent/graphs/supervisor_graph.py  ← register doc_generator_graph as a node
app/agent/graphs/doc_generator_graph.py  ← NEW: compiled independently
app/agent/subagents/
    ├── doc_planner.py
    └── document_generator_worker.py
app/agent/storage/file_store.py          ← OR app/services/file_store.py — pick one (see layout above)
```

### What state you add

In **`app/agent/state/schema.py`**:

```python
class DocEntry(TypedDict):
    title: str              # "Auth Service — Component Overview"
    component_slug: str     # matches DiagramEntry.component_slug — the pairing key
                            # "" for overview.md, ADRs, runbooks
    content: str            # raw Markdown — references matching diagram by path/title
    path: str               # reports/{thread_id}/{slug}.md

class DocWorkerState(TypedDict):
    doc_filename: str                           # "auth-service.md"
    component_slug: str                         # for pairing with diagram
    task_requirement: str
    architecture_json: dict
    generated_diagrams: list[DiagramEntry]      # worker reads this to reference diagrams
    draft_content: str

# GlobalSwarmState additions:
#   generated_docs: Annotated[list[DocEntry], operator.add]   ← same reducer pattern
#   docs_complete: bool   ← set True when doc sub-graph finishes; unlocks reviewers
```

### Output files produced

```
output/{thread_id}/overview.md
output/{thread_id}/api-gateway.md        ← pairs with iter{n}_component-api-gateway.mmd
output/{thread_id}/auth-service.md       ← pairs with iter{n}_component-auth-service.mmd
output/{thread_id}/adr-caching.md        ← cross-cutting, component_slug = ""
```

Each `.md` file **references its paired `.mmd`** by path:
*"See `diagrams/{thread_id}/iter1_component-auth-service.mmd` for the sequence diagram."*

This is the pairing invariant. `component_slug` is the linking key in both entries.

### What you learn

- How to apply `Send` a second time — the pattern is identical, the context differs
- How cross-agent reading works: doc workers read `generated_diagrams` from `GlobalSwarmState`
  without knowing how those diagrams were generated
- Why `component_slug` is consistent across `DiagramEntry`, `DocEntry`, and file keys —
  it is the product invariant that lets the frontend group paired artifacts
- Why `docs_complete = True` is the explicit signal the supervisor waits for before
  routing to reviewers (never infer completeness from list length)

### Acceptance criteria

```bash
cd ai-backend && python -m app.agent.run "Design a URL shortener"
# generated_docs has M entries matching doc_plan
# For each component C, there is exactly one DiagramEntry and one DocEntry with the same component_slug
# Each .md file contains a reference to its paired .mmd path
# docs_complete is True in final state
```

---

## Phase 9 — Parent Graph Supervisor Loop

> **Core concept**: cyclic parent graph, the full routing function written in final form,
> `iteration_count` as circuit breaker, all sub-graphs wired together

### What you build

```
app/agent/state/schema.py               ← add iteration_count, next_agent, reviewer feedback fields
app/agent/graphs/supervisor_graph.py    ← full cyclic parent graph
app/agent/subagents/supervisor_router.py ← routing function in final form
```

### What state you add

```python
# app/agent/state/schema.py — GlobalSwarmState additions:
#   iteration_count: int          # supervisor increments every lap; hard limit = 5
#   next_agent: str               # routing flag
#   scalability_feedback: str     # "" until Phase 10; stub returns "STATUS: APPROVED"
#   security_feedback: str        # "" until Phase 10; stub returns "STATUS: APPROVED"
```

### The routing function — written in final form right now

Write this once. You will **not touch it again** — future phases just make previously-dead
branches live.

```python
# app/agent/subagents/supervisor_router.py
def supervisor_route(state: GlobalSwarmState) -> str:
    if state["iteration_count"] >= 5:                              # circuit breaker — always first
        return "END"
    if not state.get("architecture_json"):                         # no architecture yet
        return "architect_graph"
    # ⚠️  Never set architecture_json = {} to mean "unset" — empty dict is falsy
    # and will re-trigger the architect on every lap. Use None / missing key as the sentinel.
    # Once architect runs it always writes a non-empty dict, so this guard is safe.
    if not state.get("docs_complete"):                             # docs not yet generated
        return "doc_generator_graph"
    scalability = state.get("scalability_feedback", "")
    security = state.get("security_feedback", "")
    if not scalability or "REJECTED" in scalability:               # needs scalability review
        return "scalability_node"
    if not security or "REJECTED" in security:                     # needs security review
        return "security_node"
    return "END"                                                   # both approved
```

In Phase 9, `scalability_node` and `security_node` are **stubs** that immediately return
`{"scalability_feedback": "STATUS: APPROVED"}` — they just prove the routing works.
Phase 10 swaps in real reviewer logic without touching this function.

### Full parent graph shape

```
START → supervisor_node → [conditional] → architect_graph      → supervisor_node
                                        → doc_generator_graph  → supervisor_node
                                        → scalability_node     → supervisor_node
                                        → security_node        → supervisor_node
                                        → END
```

### What you learn

- How `add_conditional_edges` wires the supervisor to all downstream nodes
- Why the circuit breaker is always checked **first** in the routing function
- Why the supervisor never generates content — it only reads state and routes
- The full loop: supervisor decides → worker runs → worker returns to supervisor → repeat

### Acceptance criteria

```bash
cd ai-backend && python -m app.agent.run "Design a URL shortener"
# With stubs: supervisor → architect → supervisor → docs → supervisor → scalability (stub APPROVED)
#           → supervisor → security (stub APPROVED) → supervisor → END
# iteration_count = 1 in final state

# Force test: init with iteration_count=5
# Expected: goes straight to END, no nodes run
```

---

## Phase 10 — Reviewer Agents + Rejection Loop

> **Core concept**: adversarial prompting, APPROVED/REJECTED parsing, the review-revise
> loop end-to-end, rejection drives supervisor back to architect

### What you build

```
app/agent/subagents/
    ├── scalability_expert.py   ← replace stub with real adversarial prompt
    └── security_auditor.py    ← replace stub with real adversarial prompt
```

No graph topology changes. Supervisor routing stays identical. The stub implementations
in **`app/agent/subagents/scalability_expert.py`** and **`app/agent/subagents/security_auditor.py`** are replaced
with real LLM calls — the graph wiring in **`app/agent/graphs/supervisor_graph.py`** does not change at all.

### What state you add

Nothing new. `scalability_feedback` and `security_feedback` already exist from Phase 9.

### What each reviewer does

**Scalability Expert** (capable model) reads ALL `generated_diagrams` + ALL `generated_docs`
+ `architecture_json`:
- Evaluates: TPS estimates, SPOFs, missing caches, DB connection pool limits
- System prompt: *assume the system is already failing under load — play devil's advocate*
- Output: Markdown critique ending with `STATUS: APPROVED` or `STATUS: REJECTED`

**Security Auditor** (capable model), same inputs:
- Evaluates: missing WAFs, exposed DBs, absent rate limiting, unencrypted transit, VPC issues
- System prompt: *assume the system is under active attack right now*
- Output: Markdown critique ending with `STATUS: APPROVED` or `STATUS: REJECTED`

### How REJECTED drives the loop

The supervisor routing (written in Phase 9) already handles this — it just becomes real:

- `REJECTED` in `scalability_feedback` → supervisor routes back to `architect_graph`
- `REJECTED` in `security_feedback` → supervisor routes back to `architect_graph`

When architect re-runs on iteration 2, it reads the rejection critique from state and
produces an improved architecture. New diagrams and docs are generated. Reviewers see
the improved artifacts. Circuit breaker fires at iteration 5.

Log each reviewer pass to `debate_logs` in state (simple list, not DB yet). Add **`DebateLogEntry`** to **`app/agent/state/schema.py`**:

```python
class DebateLogEntry(TypedDict):
    agent: str          # "scalability" | "security"
    feedback: str       # the full Markdown critique
    status: str         # "APPROVED" | "REJECTED"
    iteration: int
```

### Acceptance criteria

```bash
cd ai-backend && python -m app.agent.run "Design a URL shortener"
# Full loop: supervisor → architect → docs → scalability → security → END (if both APPROVED)
# LangSmith: full multi-node trace with all agent decisions visible

# Force rejection test: temporarily make scalability_expert always return REJECTED
# Watch: iteration_count climbs to 5 → circuit breaker fires → END
# Final state has iteration_count = 5, scalability_feedback contains "REJECTED"
```

---

## Phase 11 — Persistence, File Store, and DB

> **Core concept**: `AsyncPostgresSaver`, `thread_id` survives restarts, the two-schema
> Postgres separation, Alembic exclusion filter

### What you build

```
ai-backend/app/db/
    ├── engine.py             ← SQLAlchemy async engine (public schema)
    ├── models.py             ← Session, DebateLog, User tables
    ├── checkpointer.py       ← AsyncPostgresSaver (langgraph schema)
    └── deps.py               ← FastAPI dependency: get_db()

# FileStore: finalize in app/agent/storage/file_store.py OR app/services/file_store.py (match Phase 8)

ai-backend/alembic/
    ├── env.py                ← CRITICAL: exclude langgraph schema
    └── versions/
        └── 001_initial.py    ← sessions + debate_logs tables only
```

### The two-schema separation

| Layer | Tables | Managed by | Postgres schema |
|---|---|---|---|
| Your app | `sessions`, `debate_logs` | SQLAlchemy + Alembic | `public` |
| LangGraph | `checkpoints`, `checkpoint_blobs`, etc. | LangGraph internally | `langgraph` |

**Critical — Alembic env.py filter:**

```python
def include_object(object, name, type_, reflected, compare_to):
    if hasattr(object, "schema") and object.schema == "langgraph":
        return False
    return True
```

Without this filter, `alembic revision --autogenerate` tries to manage LangGraph's
internal tables and creates conflicts you cannot resolve cleanly.

### Session model tracks swarm progress

```python
class Session(Base):
    __tablename__ = "sessions"
    thread_id       = Column(UUID, primary_key=True)
    requirement     = Column(Text, nullable=False)
    status          = Column(String(20), default="running")   # running | done | failed
    complexity      = Column(Integer, nullable=True)
    diagram_count   = Column(Integer, nullable=True)
    doc_count       = Column(Integer, nullable=True)
    created_at      = Column(DateTime(timezone=True), server_default=func.now())
    completed_at    = Column(DateTime(timezone=True), nullable=True)
```

### What you learn

- How `await checkpointer.setup()` at startup is idempotent — safe to call every time
- Why `MemorySaver` was enough for learning but not for production
- How `thread_id` survives a process restart when using Postgres
- File store: content lives in state (working copy for agents); files on disk/R2 are
  the persistent record for downloads and the frontend

### Acceptance criteria

```bash
# Start a run (from ai-backend/)
python -m app.agent.run "Design a URL shortener" --thread-id abc-123

# Kill with Ctrl+C after architect finishes, before doc generator starts

# Restart and resume
python -m app.agent.run --resume --thread-id abc-123
# Expected: architect output preserved — doc generator starts where it left off
# Architect does NOT re-run. Session row in DB shows status = "running"
```

---

## Phase 12 — FastAPI + SSE Streaming + Production Hardening

> **Core concept**: `astream_events`, SSE, async background tasks, compiling the graph
> once at startup, the complete production API surface

### What you build

```
ai-backend/app/main.py                    ← FastAPI app, lifespan, graph on app.state
ai-backend/app/api/v1/router.py           ← include swarm router
ai-backend/app/api/v1/endpoints/swarm.py ← POST /start, GET /stream/{id}, POST /human-feedback
```

Wire routes under the same prefix your app already uses for v1 (e.g. `/api/v1/...`); the examples below use `/api/swarm/...` — adjust path strings to match **`router.py`**.

### Three endpoints

**`POST /api/swarm/start`**
Creates a `sessions` row. Kicks off `graph.ainvoke()` as `asyncio.create_task()` (not awaited).
Returns `{"thread_id": "..."}` immediately.

**`GET /api/swarm/stream/{thread_id}`**
SSE endpoint using `graph.astream_events(None, config, version="v2")`.
Every completed node emits one event with `node` name and `state_diff`.
The frontend renders each `.mmd` and `.md` file as it arrives.

**`POST /api/swarm/human-feedback`**
Calls `graph.aupdate_state(config, new_values, as_node="supervisor_node")` to inject
feedback into a paused graph (requires `interrupt_before` on compile).
Resumes with `graph.ainvoke(None, config=config)` as a background task.

### FastAPI lifespan startup sequence

Implement **`build_swarm_graph()`** in **`app/agent/graphs/supervisor_graph.py`** (or a small `app/agent/graphs/factory.py`) and import it from **`app/main.py`**.

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Run Alembic migrations
    # 2. Set up AsyncPostgresSaver (idempotent — creates langgraph schema tables)
    # 3. Initialize FileStore
    # 4. Compile the graph ONCE — shared across all requests, never per-request
    app.state.graph = build_swarm_graph().compile(
        checkpointer=checkpointer,
        interrupt_before=["scalability_node", "security_node"]   # human-in-the-loop
    )
    yield
```

### What you learn

- How `astream_events` gives node-level visibility: one event per completed diagram, per doc,
  per reviewer pass
- Why the graph is compiled **once** at startup — compiling is expensive; the compiled graph
  is async-safe and shared across requests
- How `interrupt_before` + `aupdate_state` + `ainvoke(None)` implements human-in-the-loop
- How `ainvoke(None, config)` resumes an existing thread vs `ainvoke(initial_state, config)`
  starts a new one

### Acceptance criteria

```bash
# Terminal 1 (working directory: ai-backend/)
uvicorn app.main:app --reload

# Terminal 2
curl -X POST localhost:8000/api/swarm/start \
  -d '{"requirement": "Design a URL shortener"}'
# {"thread_id": "abc-789"}

# Terminal 3
curl -N localhost:8000/api/swarm/stream/abc-789
# data: {"node": "draft_node", "state_diff": {"architecture_json": {...}}}
# data: {"node": "diagram_generator_node", "state_diff": {"generated_diagrams": [...]}}
# ... one event per diagram, one per doc, one per reviewer pass
# data: {"node": "security_node", "state_diff": {"security_feedback": "STATUS: APPROVED"}}
```

---

## State Growth Timeline

Every field added when — and only when — a real capability needed it.

```
Phase 0:  (no state — empty modules)
Phase 1:  task_requirement, architecture_draft
Phase 2:  + architecture_json, component_list, complexity_score, diagram_plan, doc_plan
          (remove: architecture_draft — replaced by architecture_json)
Phase 3:  + deep_dive_notes
Phase 4:  (no new fields — checkpointer change only)
Phase 5:  + current_architecture_mermaid
          + ArchitectInternalState TypedDict (internal to sub-graph, invisible to parent)
          (linter_errors, draft_mermaid: never in GlobalSwarmState — live in ArchitectInternalState)
Phase 6:  + DiagramEntry TypedDict (component_slug field established)
          + generated_diagrams: Annotated[list[DiagramEntry], operator.add]
Phase 7:  + DiagramWorkerState TypedDict
          (Send fan-out makes generated_diagrams actually fill up)
Phase 8:  + DocEntry TypedDict (component_slug mirrors DiagramEntry)
          + DocWorkerState TypedDict
          + generated_docs: Annotated[list[DocEntry], operator.add]
          + docs_complete: bool
Phase 9:  + iteration_count, next_agent
          + scalability_feedback: str (stub "" → Phase 10 fills it)
          + security_feedback: str   (stub "" → Phase 10 fills it)
Phase 10: + DebateLogEntry TypedDict in app/agent/state/schema.py (in-memory list for now)
Phase 11: (no new GlobalSwarmState fields — DB + file store layer change only)
Phase 12: (no new GlobalSwarmState fields — API wrapper only)
```

By Phase 12 you will have built every field in `GlobalSwarmState` yourself — one at a
time, each motivated by a real need. You will know exactly why each one exists.

---

## Appendix A — Truths to Internalize

1. **The graph owns control flow; the LLM owns content.** Routing is always Python-first.
   Never let a prompt decide which node runs next.

2. **Nodes return partial updates.** A node that only changes one field returns
   `{"that_field": new_value}`. LangGraph merges it. Never return the whole state.

3. **Reducers are how parallel workers safely merge list updates.** `Annotated[list, operator.add]`
   is not optional for any field that receives parallel `Send` writes.

4. **`Send` is how you express dynamic parallelism** — one worker per component for diagrams
   and docs — when N is unknown at compile time.

5. **Sub-graphs hide internal complexity.** The supervisor sees a black box. The parent graph
   cannot name inner nodes. This isolation is the point.

6. **Sub-graphs are topology; subagents are roles.** Files under **`app/agent/graphs/`** wire nodes. **`app/agent/subagents/`** holds prompts, structured output schemas, and the callable each node invokes.
   Never put a system prompt in a graph file.

7. **`component_slug` is the product invariant.** Every `DiagramEntry`, `DocEntry`, and
   file key for component-scoped artifacts carries the same slug. This is what lets the
   frontend group paired artifacts. Do not break this pairing.

8. **Checkpointers turn a demo into a product.** Resume, audit, replay — none of these
   are possible without a persistent checkpointer. `MemorySaver` is for learning phases only.

---

## Appendix B — Common Failure Modes

| Symptom | Likely Cause | Fix |
|---|---|---|
| Only the last diagram survives | Missing `Annotated[list, operator.add]` | Add the annotation; each node returns only the new slice |
| `Send` seems ignored | Wrong node name in `Send()`; planner didn't return `list[Send]` | Verify node name matches exactly; return `list[Send]` not a dict |
| Supervisor loops forever | No iteration cap; `REJECTED` routing never resolves | `iteration_count >= 5` must be checked first in routing fn |
| State "forgets" previous fields | Node accidentally returned full state replacement | Nodes must return **partial** dicts — only changed keys |
| Migrations fight LangGraph tables | Alembic not excluding `langgraph` schema | Add `include_object` filter in **`ai-backend/alembic/env.py`** |
| Missing doc for a component | `doc_plan` not built from the same slugified `component_list` as `diagram_plan` | Fix slug derivation in Complexity Analyzer — both plans must use the same slug |
| Orphan diagram with no paired doc | `component_slug` inconsistent between `DiagramEntry` and `DocEntry` | Both workers must receive and write the same slug from the same plan entry |
| Reviewers "miss" obvious issues | Passed only a subset of state to reviewer prompt | Ensure all `generated_diagrams` and `generated_docs` content is in the prompt context |
| Sub-graph changes leak to parent | Node inside sub-graph directly mutated a `GlobalSwarmState` field it does not own | Enforce state handoff contract — each agent writes only its own fields |
| Resume runs the whole graph again | `thread_id` not passed, or `MemorySaver` lost state on restart | Pass `thread_id` in config; use `AsyncPostgresSaver` in Phase 11+ |

---

## Suggested Timeboxing

| Phase block | Focus | Days |
|---|---|---|
| Phases 0–2 | Foundation: skeleton, single LLM node, linear pipeline | Days 1–2 |
| Phases 3–4 | Control flow: routing, checkpointing | Days 3–4 |
| Phase 5 | First sub-graph, internal state isolation | Days 5–6 |
| Phase 6 | Reducers in isolation — the key experiment | Day 7 |
| Phases 7–8 | Map-reduce for diagrams then docs | Week 2 |
| Phases 9–10 | Supervisor loop + real reviewer agents | Week 3 |
| Phases 11–12 | Persistence, FastAPI, production hardening | Week 4+ |

Depth beats speed. If Phase 6 does not click, do not move to Phase 7.
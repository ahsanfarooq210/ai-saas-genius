# LangGraph Incremental Learning Plan — Architecture Swarm (Step by Step)

> **Purpose**: This document is a **pedagogical build sequence**. You implement the **same ultimate product** as [`Plan.md`](../architecture/plan.md): a multi-agent **swarm** of **subagents** that collaborates to produce **application / system architecture** — for **each architecture component**, **one Mermaid diagram** and **one Markdown doc**, plus an **overview** pair and optional cross-cutting artifacts, then **scalability** and **security** review loops.  
> **Do not** replace [`Plan.md`](../architecture/plan.md); that file remains the **full target architecture**. This file tells you **what to build in which order** so each step teaches one LangGraph idea at a time.
>
> **Live code may differ:** For the running system, read [how-the-swarm-graph-works.md](../current/how-the-swarm-graph-works.md) and [state-merge-and-artifacts.md](../flows/state-merge-and-artifacts.md). Reducers are on **subgraph** state, not parent `GlobalSwarmState`.

---

## How to use this document

1. **Complete phases in order** unless a phase explicitly says “optional skip.”
2. After each phase, **stop and run** your graph manually (REPL, script, or minimal API) until the **acceptance criteria** pass.
3. When you need the **final field names, topology, or storage layout**, open [`Plan.md`](../architecture/plan.md) — but **only pull forward** what the current phase allows (avoid “building the whole swarm” early).
4. Keep a **lab notebook** (short bullets): what you learned, what broke, and which LangGraph API fixed it.

---

## Table of contents

1. [North star (unchanged use case)](#1-north-star-unchanged-use-case)  
   1.1 [Component-centric artifacts (one Mermaid + one Markdown per component)](#11-component-centric-artifacts-one-mermaid--one-markdown-per-component)  
   1.2 [Subagent roster (who does what in the swarm)](#12-subagent-roster-who-does-what-in-the-swarm)
2. [Concept → phase map](#2-concept--phase-map)
3. [Prerequisites](#3-prerequisites)
4. [Phase 0 — Project skeleton and vocabulary](#phase-0--project-skeleton-and-vocabulary)
5. [Phase 1 — One node, one state, one invocation](#phase-1--one-node-one-state-one-invocation)
6. [Phase 2 — Linear multi-step pipeline](#phase-2--linear-multi-step-pipeline)
7. [Phase 3 — Conditional routing (the mini-supervisor)](#phase-3--conditional-routing-the-mini-supervisor)
8. [Phase 4 — Checkpoints, `thread_id`, time travel (basics)](#phase-4--checkpoints-thread_id-time-travel-basics)
9. [Phase 5 — First subgraph: “Architect v0” (sequential only)](#phase-5--first-subgraph-architect-v0-sequential-only)
10. [Phase 6 — Reducers: `Annotated[..., operator.add]`](#phase-6--reducers-annotated-operatoradd)
11. [Phase 7 — Map–reduce with `Send`: parallel diagram workers](#phase-7--mapreduce-with-send-parallel-diagram-workers)
12. [Phase 8 — Doc subgraph: plan → parallel doc workers → reduce](#phase-8--doc-subgraph-plan--parallel-doc-workers--reduce)
13. [Phase 9 — Parent graph supervisor loop (full orchestration shape)](#phase-9--parent-graph-supervisor-loop-full-orchestration-shape)
14. [Phase 10 — Reviewer agents + rejection loops + iteration cap](#phase-10--reviewer-agents--rejection-loops--iteration-cap)
15. [Phase 11 — Persistence, file store, and API hardening](#phase-11--persistence-file-store-and-api-hardening)
16. [Phase 12 — Polish to match `Plan.md` (production parity)](#phase-12--polish-to-match-planmd-production-parity)
17. [Appendix A — Truths to internalize](#appendix-a--truths-to-internalize)
18. [Appendix B — Common failure modes](#appendix-b--common-failure-modes)

---

## 1. North star (unchanged use case)

**User input**: a natural-language requirement (example: “Design a globally distributed URL shortener” or “Architecture for a multi-tenant B2B SaaS with SSO”).

**System output** (end state, aligned with [`Plan.md`](../architecture/plan.md)):

| Artifact | Role |
|----------|------|
| **Architecture description** | Structured representation (`architecture_json`) plus **`component_list`** — the canonical list of named components (services, data stores, gateways, etc.). |
| **Primary overview Mermaid** | System-level view in `current_architecture_mermaid` (and usually mirrored as a `DiagramEntry` for `overview`). |
| **Per-component Mermaid files** | **One diagram per architecture component** (boundary, key deps, interfaces for *that* component). |
| **Per-component Markdown files** | **One doc per architecture component** (responsibilities, APIs, data, failure modes, links to its diagram). |
| **Cross-cutting docs & diagrams** | On top of the per-component baseline, [`Plan.md` §5.3](../architecture/plan.md) adds **extra** items from controlled vocabularies (`auth-flow`, `db-schema`, ADRs, runbooks, etc.) when `complexity_score` is high — see §1.1. |
| **Scalability review** | **Scalability Expert** subagent → **APPROVED** or **REJECTED** + concrete fixes. |
| **Security review** | **Security Auditor** subagent → same contract. |
| **Supervisor loop** | **Supervisor Router** subagent cycles the swarm until both approve or an **iteration circuit breaker** fires. |

**Learning constraint**: early phases produce **toy** versions of these artifacts (e.g. two fake components, no parallelism). Later phases swap in **real `component_list`**, **paired diagram+doc workers**, **`Send`**, and **extra** diagram/doc types without changing the *meaning* of the product.

### 1.1 Component-centric artifacts (one Mermaid + one Markdown per component)

This is the **direction of travel** for the whole swarm: artifacts are **anchored to `component_list`**, not only to abstract “diagram types.”

**Baseline pairing (every run, once `component_list` is stable)**

| For each component `C` (display name + stable `slug`) | Mermaid | Markdown |
|------------------------------------------------------|---------|----------|
| Dedicated artifact | One **component-focused** diagram (context, neighbors, critical paths). | One **`{slug}.md`** (or `{component-name}.md` per [`Plan.md` §5.3](../architecture/plan.md) slug rules). |

**System-wide baseline (almost always)**

| Artifact | Purpose |
|----------|---------|
| **Overview Mermaid** | Big-picture; often the first diagram; stored in `current_architecture_mermaid` and as a `DiagramEntry` with `diagram_type` e.g. `overview`. |
| **`overview.md`** | Executive summary, context, links into per-component docs. |

**On top of the baseline (complexity-driven, from Complexity Analyzer)**

[`Plan.md`](../architecture/plan.md) uses `diagram_plan` and `doc_plan` built at runtime. Treat them as:

1. **Required core**: `overview` + **one diagram + one doc per component** (pair by **shared `slug`** so the frontend can group them).
2. **Optional extras** (when score is higher): e.g. `auth-flow`, `db-schema`, `adr-*.md`, `runbook-*.md` — see [`Plan.md` §5.3](../architecture/plan.md).

**State / file conventions (learning targets)**

- Each `DiagramEntry` should carry at least: `diagram_type`, `content`, `path`, `iteration`, and preferably **`component_slug`** (or `None` for purely cross-cutting diagrams like `auth-flow`).
- Each `DocEntry` should carry: `title`, `content`, `path`, and preferably **`component_slug`** (or `None` for `overview.md`, ADRs, runbooks).
- File store keys stay consistent with [`Plan.md` §8.5](../architecture/plan.md), e.g. `diagrams/{thread_id}/iter{n}_{diagram_type}.mmd` and `reports/{thread_id}/{slug}.md` — for component pairs, embed the **same `slug`** in both diagram and doc paths where it helps downloads (e.g. `..._component-api-gateway.mmd` ↔ `api-gateway.md`).

**Why this matters for LangGraph**

- The **number of components** is unknown until the **Lead Architect** + **Complexity Analyzer** run → you will use **`Send`** to fan out **one Diagram Generator subagent invocation per planned diagram** and **one Document Generator subagent invocation per planned doc**, including **one pair per component**.

### 1.2 Subagent roster (who does what in the swarm)

In this plan, a **subagent** means: a **named role** with its own system prompt, inputs, and outputs — implemented as **one or more LangGraph nodes** (or as the **worker** inside a `Send`). **Sub-graphs** (`architect_graph`, `doc_generator_graph`) bundle several subagents; the **parent graph** only sees those bundles + reviewer nodes.

| Subagent (role) | Where it lives | Model tier (per [`Plan.md`](../architecture/plan.md)) | Reads (main inputs) | Writes (main outputs) |
|-------------------|----------------|----------------------------------------|---------------------|------------------------|
| **Supervisor Router** | Parent graph — `supervisor_node` | smaller (e.g. mini) | Full `GlobalSwarmState` | Routing only: next branch / `END`; increments `iteration_count` |
| **Lead Architect** | Architect sub-graph — draft node | capable | `task_requirement`, optional tools | `architecture_json`, initial `component_list`, internal draft fields |
| **Complexity Analyzer** | Architect sub-graph | smaller | `architecture_json`, `component_list` | `complexity_score`, finalized **`diagram_plan`**, **`doc_plan`** (must include per-component + overview + extras per rules) |
| **Diagram Planner** | Architect sub-graph (optional separate node) | code or small LLM | `diagram_plan` | `list[Send]` targets for diagram workers |
| **Diagram Generator** (worker) | Architect sub-graph — **one invocation per Send** | capable | `DiagramWorkerState` + Mermaid linter tool | One `DiagramEntry` → **`generated_diagrams`** (reducer) |
| **Mermaid linter** | Tool (not LLM) | — | Mermaid string | Parse errors for repair loop |
| **Doc Planner** | Doc sub-graph | smaller | `component_list`, `complexity_score`, diagrams in state | Finalizes doc list; returns `list[Send]` for doc workers |
| **Document Generator** (worker) | Doc sub-graph — **one invocation per Send** | capable | One doc spec + `architecture_json` + all diagrams | One `DocEntry` → **`generated_docs`** (reducer); persist file |
| **Scalability Expert** | Parent graph — plain node | capable | All diagrams, all docs, `architecture_json` | `scalability_feedback` (`APPROVED` / `REJECTED`) |
| **Security Auditor** | Parent graph — plain node | capable | Same as scalability | `security_feedback` |

**How this maps to your repo layout (recommended)**

Mirror roles in code so each subagent is **one module** (prompt + node function + optional structured-output schema):

```text
app/agent/
├── graphs/                 # compiled StateGraphs
├── nodes/                  # thin wrappers if you prefer
├── subagents/              # one file per *role* above (prompts, schemas, invoke helpers)
│   ├── supervisor_router.py
│   ├── lead_architect.py
│   ├── complexity_analyzer.py
│   ├── diagram_planner.py            # optional — often a small node module that returns list[Send]
│   ├── diagram_generator_worker.py
│   ├── doc_planner.py                # optional — same pattern for doc fan-out
│   ├── document_generator_worker.py
│   ├── scalability_expert.py
│   └── security_auditor.py
├── tools/
│   └── mermaid_linter.py
└── state.py                # TypedDicts
```

Sub-graph files (`architect_graph.py`, `doc_generator_graph.py`) **import** from `subagents/` and **wire** nodes; they should stay mostly **topology**, not prose prompts.

**Collaboration flow (mental model)**

1. Supervisor sends work to **Architect** sub-graph → Lead Architect + Complexity Analyzer produce **`component_list`** and plans.  
2. **Diagram Generator** subagents (parallel) produce **one Mermaid each** (including **one per component** + overview + extras).  
3. Supervisor sends work to **Doc** sub-graph → **Document Generator** subagents produce **one Markdown each** (including **`{slug}.md` per component** + `overview.md` + extras). Docs should **reference** diagrams by title / path (per [`Plan.md` §5.5](../architecture/plan.md)).  
4. **Scalability Expert** and **Security Auditor** read **everything** and approve or reject.  
5. Supervisor loops until done or cap.

---

## 2. Concept → phase map

| LangGraph / swarm idea | Introduced in phase |
|------------------------|---------------------|
| `StateGraph`, `START`, compiled graph, `invoke` | 1 |
| Multiple nodes, immutability patterns, pure-ish node returns | 2 |
| Conditional edges, routing functions | 3 |
| Checkpointer, thread config, resume / replay | 4 |
| Nested graph as a **single node** in a parent; **Architect** subagents bundled inside | 5 |
| `Annotated[list, operator.add]` reducers | 6 |
| `Send` API, map–reduce; **Diagram Generator** workers (per-component + overview) | 7 |
| **Doc** sub-graph; **Document Generator** workers (per-component + overview) | 8 |
| Parent **Supervisor** + full subagent loop handoff | 9 |
| **Scalability** + **Security** subagents, rejection loops, caps | 10 |
| DB checkpointer, file store, FastAPI streaming | 11–12 |

---

## 3. Prerequisites

- **Python** comfortable with `TypedDict`, typing, and async (`async def`).
- **LLM access** (OpenAI or other) with a **small** model for routing experiments and a **capable** model for architecture drafting when you reach Phase 5+.
- **LangGraph** installed in your backend environment (pin versions in `requirements.txt` when you add them).
- Read once (skim is fine): LangGraph docs topics **StateGraph**, **Send**, **Subgraphs**, **Persistence / checkpointer**, **Streaming** — you will **revisit** each in depth per phase.

---

## Phase 0 — Project skeleton and vocabulary

### Learning goals

- Know the **three layers** you will keep separate: **graph topology**, **state schema**, **node implementations** (LLM calls, tools).
- Agree on **naming** early so later phases match [`Plan.md`](../architecture/plan.md): `GlobalSwarmState`, `task_requirement`, `architecture_json`, `generated_diagrams`, etc.

### Scope (do now)

- Create package layout under `app/agent/` (mirror [`Plan.md` §10](../architecture/plan.md) when you add files):
  - `state.py` (or `schema.py`) — **only** TypedDicts / dataclasses for state.
  - `graphs/` — one file per graph while learning; you can merge later.
  - `nodes/` — optional thin wrappers that call into `subagents/`.
  - `subagents/` — **one module per subagent role** (§1.2): prompts, structured outputs, and the callable the graph node uses.
  - `llm.py` — thin wrapper around your chat model client.
- **Do not** implement Postgres, R2, or FastAPI yet unless you already have them; a `main` block or CLI that calls `graph.invoke` is enough.

### Deliverables

- Empty modules with docstrings stating which **phase** will fill them.
- See `docs/README.md` for where planning and current-state docs live; avoid adding more markdown next to Python modules.

### Acceptance criteria

- You can import your package without circular imports.
- You can state in one sentence: **nodes return partial state updates; the graph merges them.**

### Pitfalls

- Putting LLM calls inside routing functions — keep routing **cheap and deterministic** (read state only, or tiny model later).

---

## Phase 1 — One node, one state, one invocation

### Learning goals

- Build a **minimal** `StateGraph` with **one node** and compile it.
- Run `invoke` / `ainvoke` and inspect **final state**.

### Use-case slice

- **Node: `draft_architecture_v0`**
  - Input: `task_requirement: str`
  - Output: `architecture_draft: str` (plain Markdown prose is fine — not Mermaid yet if you want less friction)

### State shape (minimal)

```text
task_requirement: str
architecture_draft: str   # default ""
```

Use a `TypedDict` with **defaults** via a small helper that seeds first input, or LangGraph’s recommended initialization pattern you adopt in your codebase.

### Deliverables

- `build_phase1_graph()` → compiled graph.
- Script: given one string prompt, prints `architecture_draft`.

### Acceptance criteria

- Same input run twice may differ (LLM), but **state keys** are stable.
- No conditional edges yet.

### What you’re learning

- **Node contract**: return a `dict` (or command object later) that **only** contains keys you want merged.

### Stretch (optional)

- Log token usage per call.

---

## Phase 2 — Linear multi-step pipeline

### Learning goals

- Chain **two or three nodes** with **fixed** edges: `A → B → C → END`.
- See how **each** node reads growing state.

### Use-case slice

1. **`draft_architecture`** — prose / bullet architecture.
2. **`extract_components`** — LLM returns a **JSON-serializable** list `component_list` (force JSON mode or structured output).
3. **`score_complexity`** — LLM returns integer `complexity_score` 1–10 **or** a simple heuristic from component count in v0.

### State additions

```text
component_list: list[str]   # default []
complexity_score: int        # default 0
```

### Deliverables

- Linear graph only.
- Unit-style assertion: `complexity_score` in 1..10 when using the LLM path.

### Acceptance criteria

- Order is always draft → components → score; no branching.

### Pitfalls

- Letting the model output invalid JSON — add **retry** or a **repair** node later; for Phase 2, a try/except that sets a fallback score is acceptable **if you log the failure**.

---

## Phase 3 — Conditional routing (the mini-supervisor)

### Learning goals

- Implement **conditional edges** from one router node (or from `START` to first worker).
- Encode **priority rules** exactly like [`Plan.md` §4.2](../architecture/plan.md) but **shrunk** to your Phase 2 state.

### Use-case slice (tiny supervisor)

After scoring complexity:

- If `complexity_score >= 7` → go to **`deep_dive_outline`** node (LLM produces extra questions/constraints).
- Else → skip deep dive, go straight to **`summarize_for_user`**.

### State additions

```text
deep_dive_notes: str   # default ""
```

### Deliverables

- `route_after_complexity(state) -> Literal["deep_dive", "summarize"]`
- Visual diagram (on paper or Mermaid) of this tiny graph.

### Acceptance criteria

- Routing depends **only** on state fields you set in Phase 2.
- You can explain why this is a **rehearsal** for the real `supervisor_route` in [`Plan.md`](../architecture/plan.md).

### Pitfalls

- Encoding business rules in **both** Python and prompt — pick one source of truth; Python should own **control flow**.

---

## Phase 4 — Checkpoints, `thread_id`, time travel (basics)

### Learning goals

- Compile with a **checkpointer** (start with **in-memory** or **SQLite** if Postgres not ready).
- Run multiple turns on the **same** `thread_id` with **human-like** follow-up messages modeled as state updates.

### Use-case slice

- Treat `task_requirement` as immutable; add `user_clarification: str` that the user can append between invocations **or** simulate two `invoke` calls where the second merges `{ "user_clarification": "..." }`.

### Deliverables

- `graph.get_state(config)` after runs — inspect checkpoints.
- Ability to **resume** after a crash (kill process, rerun) for the same thread (memory checkpointer won’t survive process death — that’s OK; note the limitation).

### Acceptance criteria

- You can narrate: **checkpoint = persisted execution trace + state snapshot**.

### When to use Postgres

- Defer **`AsyncPostgresSaver`** until Phase 11 unless you enjoy hard-mode debugging — but read [`Plan.md` §8](../architecture/plan.md) early so you don’t paint yourself into a schema corner.

---

## Phase 5 — First subgraph: “Architect v0” (sequential only)

### Learning goals

- Build a **child** `StateGraph` that implements a **subset** of [`Plan.md` §4.3 Architect subgraph](../architecture/plan.md) **without** `Send`.
- **Compile** the child, then **`add_node("architect", child_graph)`** in a parent graph that right now might be trivial (`START → architect → END`).

### Use-case slice (sequential architect)

Inside the child graph (these map to **Lead Architect** + early analysis; align with [`Plan.md` §5.2](../architecture/plan.md) before you add the **Complexity Analyzer** subagent):

1. **`draft_mermaid_overview`** — produces `current_architecture_mermaid` (string).
2. **`lint_mermaid_placeholder`** — for learning, implement as: “if string empty → error” or call a real Mermaid validator later.
3. **`write_architecture_json`** — LLM produces `architecture_json` and a **`component_list`** you will later use to drive **one Mermaid + one Markdown per component** (§1.1).

Even in v0, **name components clearly** (e.g. “API Gateway”, “Auth Service”) so later phases can slug them for paired artifacts.

### State

- Either **lift** fields into the same `GlobalSwarmState` you’ll use later, or use a dedicated `ArchitectState` and **input/output mappers** — but **prefer** aligning with [`Plan.md` §3.1](../architecture/plan.md) field names now to avoid rename churn.

### Deliverables

- `architect_graph.py` compiling standalone.
- Parent graph invoking it as one node.

### Acceptance criteria

- Parent graph’s code **does not know** inner node names — only `"architect"`.

### Pitfalls

- Forgetting to **return** partial updates that the parent needs next (e.g. `architecture_json`).

---

## Phase 6 — Reducers: `Annotated[..., operator.add]`

### Learning goals

- Add `generated_diagrams: Annotated[list[DiagramEntry], operator.add]` on **`ArchitectGraphState`** (subgraph), not on parent `GlobalSwarmState`. See [state-merge-and-artifacts.md](../flows/state-merge-and-artifacts.md).
- Prove **why** plain `list` breaks parallel updates inside a subgraph (write a **fake** parallel invocation in tests if needed).
- Prove **why** parent `GlobalSwarmState` must use **plain lists** when compiled subgraphs return full artifact snapshots (regression: `tests/test_subgraph_artifact_accumulation.py`).

### Use-case slice (still sequential)

- Implement `append_single_diagram` node that returns `{"generated_diagrams": [one_entry]}` twice in a row **in one graph run** (two nodes) and observe **list concatenation**.

### Deliverables

- Short comment block in code quoting the warning from [`Plan.md` §7](../architecture/plan.md).

### Acceptance criteria

- After two appends, length is 2, not 1.

### Pitfalls

- Returning the **whole** list from each node with `operator.add` — each node should return **only the new slice** as a one-element list.

---

## Phase 7 — Map–reduce with `Send`: parallel diagram workers

### Learning goals

- Implement **dynamic fan-out**: `diagram_planner` returns `list[Send(...)]`.
- Each worker: `diagram_generator` (+ optional `linter` loop **inside** the worker subgraph or node).
- **Reduce**: a node that asserts all workers finished; optionally filters `"syntax_error"` entries like [`Plan.md` §7](../architecture/plan.md).

### Use-case slice

- **End goal**: `diagram_plan` includes **`overview`** plus **one entry per component** (e.g. `component-api-gateway` or a structured `diagram_type` + `component_slug` in `DiagramWorkerState` — see [`Plan.md` §3.3](../architecture/plan.md)).
- **Learning path**: start with a **hardcoded** `diagram_plan` for 2 fake components + `overview`, then move the planner to the **Complexity Analyzer** subagent so counts follow [`Plan.md` §5.3](../architecture/plan.md).
- Each **`Send`** invokes the **Diagram Generator** subagent once; workers append **`DiagramEntry`** with: `diagram_type`, `content`, `path`, `iteration`, and **`component_slug`** when the diagram is component-scoped.

### Deliverables

- LangSmith trace or local logs proving **parallel** diagram generation (even if your machine runs them concurrently only at the LangGraph scheduler level).
- A table or log line that shows **≥1 diagram per component** + overview for a 3-component test `component_list`.

### Acceptance criteria

- Diagram count scales with `diagram_plan` length without adding new nodes to the graph definition.
- For a run with `component_list` length **K**, you can point to **K** component-scoped diagram entries (plus overview when included in the plan).

### Pitfalls

- Skipping `operator.add` on **subgraph** worker fields — you will lose diagrams silently.
- Putting `operator.add` on **parent** `GlobalSwarmState` artifact fields — compiled subgraphs will **duplicate** lists on return.
- Returning `Send` targets that don’t match **registered node names** exactly.

---

## Phase 8 — Doc subgraph: plan → parallel doc workers → reduce

### Learning goals

- Clone the **pattern** from Phase 7 for **Markdown** docs.
- Introduce `docs_complete: bool` and `generated_docs` reducer list per [`Plan.md`](../architecture/plan.md).

### Use-case slice

- **End goal**: `doc_plan` includes **`overview.md`** plus **`{slug}.md` for every component** in `component_list`, then optional ADRs/runbooks per [`Plan.md` §5.3](../architecture/plan.md).
- **Learning path**: hardcode `doc_plan` to mirror the component slugs from Phase 7 before teaching the **Doc Planner** subagent to emit plans from state.
- Each **`Send`** invokes the **Document Generator** subagent once; workers output one `DocEntry` with **`component_slug`** when the doc is component-scoped; docs should **cite** the matching Mermaid (by path or title).

### Deliverables

- `doc_generator_graph.py` as a compiled subgraph.

### Acceptance criteria

- Running architect then docs yields **both** diagrams and docs in state (even if supervisor is still manual).
- For each component in a test run, there exists a **paired** `.md` and component-scoped diagram (same `slug`), plus `overview` artifacts if your plan includes them.

---

## Phase 9 — Parent graph supervisor loop (full orchestration shape)

### Learning goals

- Implement the **cyclic** parent graph from [`Plan.md` §4.1](../architecture/plan.md):
  - `supervisor → {architect_subgraph, doc_subgraph, END}` via conditional edges.
- After **each** subgraph returns, control **must** return to supervisor.

### Use-case slice (simplified reviews)

- Temporarily make **Scalability Expert** and **Security Auditor** subagents **stubs**: e.g. they always `APPROVED` so you can test routing.

### State

- `iteration_count` increments in supervisor each lap.
- Hard cap **5** like [`Plan.md`](../architecture/plan.md) (configurable constant).

### Deliverables

- One function `supervisor_route(state) -> str` documented alongside [`Plan.md` §4.2](../architecture/plan.md).

### Acceptance criteria

- From empty architecture, the run touches architect before docs.
- With stubs approving, run terminates at `END`.

### Pitfalls

- Accidentally routing to docs **before** `architecture_json` exists — guard in Python, not only in prompts.

---

## Phase 10 — Reviewer agents + rejection loops + iteration cap

### Learning goals

- Replace stubs with real **Scalability Expert** and **Security Auditor** subagents (same node slots; swap in full prompts per [`Plan.md` §5.6–5.7](../architecture/plan.md)) reading **all** diagrams + docs from state.
- Encode feedback as strings; use explicit tokens **`APPROVED`** / **`REJECTED`** like [`Plan.md`](../architecture/plan.md).
- On `REJECTED`, supervisor routes back to **architect** or **docs** (your choice per product rule) — document the policy.

### Recommended policy (teaches iteration)

- If scalability rejects → route to **architect** (refresh diagrams / architecture).
- If security rejects → route to **docs** or **architect** depending on critique target — start simple: both route to **architect** for learning, then refine.

### Deliverables

- `debate_logs` table **optional** here — a simple in-memory list in state is fine until Phase 11.

### Acceptance criteria

- Forced `REJECTED` in a test fixture causes **another** lap until cap.

### Pitfalls

- Infinite loops — always enforce `iteration_count >= MAX → END`.

---

## Phase 11 — Persistence, file store, and API hardening

### Learning goals

- **Postgres checkpointer** + schema isolation per [`Plan.md` §8](../architecture/plan.md).
- **File store**: local disk dev; keys follow [`Plan.md` §8.5](../architecture/plan.md).
- **FastAPI**: expose `POST /thread`, `GET /thread/{id}/state`, streaming SSE for tokens/events (match your frontend contract).

### Deliverables

- Alembic excludes `langgraph` schema as in [`Plan.md` §8.2](../architecture/plan.md).
- Session row tracks status + counts.

### Acceptance criteria

- Survive server restart mid-thread **without** losing swarm state (Postgres checkpointer).

---

## Phase 12 — Polish to match `Plan.md` (production parity)

### Learning goals

- Close gaps between your learning graph and [`Plan.md`](../architecture/plan.md): internal worker states (`ArchitectInternalState`, `DiagramWorkerState`), Mermaid lint retry caps, structured tracing, error surfaces.

### Deliverables

- Feature flag or config to **degrade** parallelism (useful for debugging).
- README for operators: env vars, model names, limits.
- **`subagents/`** package complete for every role in §1.2; subgraphs are thin orchestration only.

### Acceptance criteria

- A full run on a non-trivial prompt produces: **overview** + **one Mermaid per component**, **overview.md** + **one Markdown per component** (pairable by `component_slug`), **optional** cross-cutting diagrams/docs per [`Plan.md` §5.3](../architecture/plan.md), and **both** reviewer **APPROVED** or a clean **cap** exit with user-visible summary.

---

## Appendix A — Truths to internalize

1. **The graph owns control flow; the LLM owns content.** Routing is code-first.
2. **Reducers** are how parallel workers **safely** merge list updates.
3. **`Send`** is how you express **dynamic parallelism** when N is unknown at compile time — including **one worker per component** for diagrams and docs.
4. **Subgraphs** are how you **hide** internal complexity from the supervisor; **subagents** are the **roles** inside those subgraphs (and in reviewer nodes).
5. **Per-component pairing** (§1.1) is a product invariant: keep **`component_slug`** consistent across `DiagramEntry`, `DocEntry`, and file keys so the UI can group artifacts.
6. **Checkpointers** turn a batch demo into a **product** (resume, audit, replay).

---

## Appendix B — Common failure modes

| Symptom | Likely cause |
|---------|----------------|
| Only last diagram survives | Missing `Annotated[..., operator.add]` |
| `Send` seems ignored | Wrong node name; planner didn’t return `list[Send]` |
| Supervisor loops forever | No iteration cap; `REJECTED` handling never satisfies guard |
| State “forgets” fields | Node returned full state replacement incorrectly — verify merge semantics |
| Migrations fight LangGraph tables | Alembic not excluding `langgraph` schema |
| Missing doc for a component / orphan diagram | `doc_plan` / `diagram_plan` not built from the same slugified `component_list`; fix in **Complexity Analyzer** |
| Reviewers “miss” issues | They only saw a subset of state; ensure **all** `generated_diagrams` and `generated_docs` are passed in the prompt context |

---

## Suggested timeboxing (optional)

| Phase block | Focus |
|-------------|--------|
| Days 1–2 | Phases 0–2 |
| Days 3–4 | Phases 3–4 |
| Week 2 | Phases 5–7 |
| Week 3 | Phases 8–10 |
| Week 4+ | Phases 11–12 |

Adjust to your schedule; **depth beats speed**.

---

**End of incremental learning plan.**  
When in doubt, compare your current graph to the **diagram** in [`Plan.md` §2](../architecture/plan.md) — that is still the **canonical target topology**.

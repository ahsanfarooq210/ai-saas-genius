# Phase 5 Report: Sub-graphs

Phase 5’s goal was **sub-graphs**: move architect nodes out of a flat graph into a compiled child `StateGraph`, register it as one opaque node on the parent, and keep the FastAPI stack unchanged.

---

## 1. Conceptual change

**Before Phase 5** — one flat graph in `run.py`:

```
START → draft_architecture_node → score_complexity_node → [conditional] → deep_dive → summarize → END
```

**After Phase 5** — parent + child:

```mermaid
flowchart LR
    subgraph Parent["supervisor_graph.py (parent)"]
        PS[START] --> AG[architect_graph]
        AG --> PE[END]
    end

    subgraph Child["architect_graph.py (sub-graph, invisible to parent)"]
        CS[START] --> DA[draft_architecture_node]
        DA --> SC[score_complexity_node]
        SC --> CE[END]
    end

    AG -.->|"single compiled node"| Child
```

The parent only knows `"architect_graph"`. It does not reference `draft_architecture_node` or `score_complexity_node`.

---

## 2. What we built

### Graph layer

| File | Role |
|------|------|
| `app/agent/graphs/architect_graph.py` | `ArchitectGraph` — sub-graph: draft → complexity; compiled **without** checkpointer |
| `app/agent/graphs/supervisor_graph.py` | `SupervisorGraph` — parent: `START → architect_graph → END`; **`MemorySaver`** on parent only |
| `app/agent/graphs/__init__.py` | Empty package marker |
| `app/agent/run.py` | `GraphBuilder.build_graph()` returns `supervisor_graph`; `swarm_config(thread_id)` for checkpoints |

### Subagents & schemas

| File | Change |
|------|--------|
| `app/agent/subagents/lead_architect.py` | Structured `ArchitectureOutput`; writes `architecture_json`, `component_list`, **`current_architecture_mermaid`** |
| `app/agent/subagents/_schema.py` | `ArchitectureOutput`, `ComponentDetail` (fix for LLM shape) |
| `app/agent/subagents/comlexity_analyzer.py` | Unchanged — reads architecture, writes score + plans |
| `app/agent/state/schema.py` | Added **`current_architecture_mermaid`** to `GlobalSwarmState` |

### FastAPI (unchanged shape, updated fields)

| File | Role |
|------|------|
| `app/services/swarm_graph_service.py` | `GraphBuilder` + initial state + `invoke` / `resume` / `get_checkpoint` |
| `app/schemas/swarm.py` | `SwarmRunResponse` includes `current_architecture_mermaid`, `deep_dive_notes` |
| `app/api/v1/endpoints/swarm.py` | `POST /run`, `POST /resume`, `GET /state/{thread_id}` |

### Bug fix (post-implementation)

Validation failed because the model returns `architecture_json` as `{ "key": { description, relations } }` without `name` inside each value. We added **`ComponentDetail`** (no `name` field) instead of `ArchitectComponent` for dict values.

---

## 3. What Phase 5 deliberately excluded

- No `deep_dive_node` / `summarize_node` in the graph (Phase 3 learning nodes removed from topology for now)
- No conditional supervisor routing (Phase 9)
- No `ArchitectInternalState` split — **Option A**: shared `GlobalSwarmState` in parent and child
- No separate Mermaid generation pipeline (Phase 7) — overview Mermaid comes from **lead architect** at draft time
- No CLI in `run.py` — FastAPI is the entry point

`deep_dive.py`, `summarize.py`, and `supervisor_router.py` still exist on disk but are **not wired** in the Phase 5 graph.

---

## 4. Full implementation topology

### 4.1 LangGraph — parent graph

```mermaid
stateDiagram-v2
    [*] --> architect_graph
    architect_graph --> [*]

    note right of architect_graph
        Compiled sub-graph
        (black box to parent)
        MemorySaver on parent only
    end note
```

### 4.2 LangGraph — architect sub-graph

```mermaid
stateDiagram-v2
    [*] --> draft_architecture_node
    draft_architecture_node --> score_complexity_node
    score_complexity_node --> [*]
```

### 4.3 State written per node

```mermaid
flowchart TB
    IN["Initial state<br/>task_requirement + empty fields"]

    IN --> LA["draft_architecture_node<br/>(LeadArchitect)"]
    LA --> S1["Writes:<br/>architecture_json<br/>component_list<br/>current_architecture_mermaid"]

    S1 --> CA["score_complexity_node<br/>(ComplexityAnalyzer)"]
    CA --> S2["Writes:<br/>complexity_score<br/>diagram_plan<br/>doc_plan"]

    S2 --> OUT["Final GlobalSwarmState<br/>returned to API"]
```

### 4.4 FastAPI request flow

```mermaid
sequenceDiagram
    participant Client
    participant API as POST /api/v1/swarm/run
    participant Svc as SwarmGraphService
    participant GB as GraphBuilder
    participant SG as supervisor_graph
    participant AG as architect_graph
    participant LA as LeadArchitect
    participant CA as ComplexityAnalyzer

    Client->>API: task_requirement, thread_id
    API->>Svc: run(task, thread_id)
    Svc->>GB: build_graph() → supervisor_graph
    Svc->>SG: invoke(initial_state, config=thread_id)
    SG->>AG: architect_graph (sub-graph)
    AG->>LA: draft_architecture_node
    LA-->>AG: architecture_json, component_list, mermaid
    AG->>CA: score_complexity_node
    CA-->>AG: complexity_score, diagram_plan, doc_plan
    AG-->>SG: merged state
    SG-->>Svc: final state
    Svc-->>API: dict
    API-->>Client: SwarmRunResponse
```

### 4.5 Module / file dependency map

```mermaid
flowchart TB
    subgraph API["FastAPI"]
        main[main.py]
        swarm_ep[api/v1/endpoints/swarm.py]
        swarm_schema[schemas/swarm.py]
    end

    subgraph Services
        sgs[swarm_graph_service.py]
    end

    subgraph Agent["app/agent"]
        run[run.py<br/>GraphBuilder + swarm_config]
        sup[graphs/supervisor_graph.py]
        arch[graphs/architect_graph.py]
        state[state/schema.py<br/>GlobalSwarmState]
        la[subagents/lead_architect.py]
        ca[subagents/comlexity_analyzer.py]
        sch[subagents/_schema.py]
        llm[core/llm.py]
    end

    main --> sgs
    swarm_ep --> sgs
    swarm_ep --> swarm_schema
    sgs --> run
    sgs --> state
    run --> sup
    sup --> arch
    sup --> state
    arch --> la
    arch --> ca
    arch --> state
    la --> sch
    la --> llm
    ca --> sch
    ca --> llm
```

---

## 5. `GlobalSwarmState` after Phase 5

```mermaid
classDiagram
    class GlobalSwarmState {
        +str task_requirement
        +str architecture_draft
        +dict architecture_json
        +list component_list
        +str current_architecture_mermaid
        +int complexity_score
        +list diagram_plan
        +list doc_plan
        +str deep_dive_notes
    }

    note for GlobalSwarmState "Phase 5 NEW field: current_architecture_mermaid"
```

**Initial state** (from `SwarmGraphService._empty_swarm_state`):

- `task_requirement` — from API body  
- Everything else empty/zero defaults  

**After a successful run**, the API response includes populated `architecture_json`, `component_list`, `current_architecture_mermaid`, `complexity_score`, `diagram_plan`, `doc_plan`.

---

## 6. Checkpointer design

```mermaid
flowchart LR
    subgraph ParentGraph["supervisor_graph"]
        CP[MemorySaver ✓]
    end

    subgraph ChildGraph["architect_graph"]
        NC[No checkpointer]
    end

    ParentGraph -->|"add_node('architect_graph', ...)"| ChildGraph
```

- Parent owns persistence (`thread_id` via `swarm_config`).
- Child is compiled once at import (`architect_graph = ArchitectGraph().build()`).
- Parent imports that object and treats it as a single node.

---

## 7. API surface (unchanged routes)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/v1/swarm/run` | New run with `task_requirement` + `thread_id` |
| `POST` | `/api/v1/swarm/resume` | Resume checkpoint for `thread_id` |
| `GET` | `/api/v1/swarm/state/{thread_id}` | Inspect checkpoint (`next`, `values`) |

---

## 8. Verification checklist (Phase 5 goals)

| # | Goal | Status |
|---|------|--------|
| 1 | `run.py` does not wire draft/complexity nodes inline | Done — only returns `supervisor_graph` |
| 2 | Parent never names inner nodes | Done — only `"architect_graph"` |
| 3 | `current_architecture_mermaid` populated | Done — from `LeadArchitect` |
| 4 | Sub-graph runs inside parent black box | Done — nested invoke in LangGraph |
| 5 | FastAPI path preserved | Done — `SwarmGraphService` unchanged in role |

---

## 9. Before → after (single diagram)

```mermaid
flowchart TB
    subgraph Before["Before Phase 5"]
        B1[run.py wires all nodes flat]
        B2[draft → complexity → deep_dive? → summarize]
    end

    subgraph After["After Phase 5"]
        A1[run.py → supervisor_graph only]
        A2[supervisor: architect_graph → END]
        A3[architect: draft → complexity → END]
        A1 --> A2 --> A3
    end

    Before --> After
```

---

## 10. What comes next (not Phase 5)

- **Phase 7** — dedicated Mermaid generation / lint loop (`ArchitectInternalState`)
- **Phase 9** — supervisor conditional routing to more sub-graphs
- **Phase 12** — streaming, human-in-the-loop, Postgres checkpointer

---

If you want this saved as `phase-5-report.md` in the repo or want diagrams for a specific request/response example (e.g. your social media automation prompt), switch to Agent mode and say where to put it.
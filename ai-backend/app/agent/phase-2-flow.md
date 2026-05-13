Here are two Mermaid views that match your code today (`app/api/v1/endpoints/swarm.py`, `app/services/swarm_graph_service.py`, `app/agent/run.py`, `GlobalSwarmState`).

---

### 1. End-to-end flow (request → graph → response)

```mermaid
sequenceDiagram
    participant C as Client
    participant API as FastAPI POST /api/v1/swarm/run
    participant S as SwarmGraphService
    participant G as Compiled LangGraph
    participant D as draft_architecture_node<br/>(LeadArchitect)
    participant SC as score_complexity_node<br/>(ComplexityAnalyzer)
    participant LLM as get_chat_llm<br/>(OpenCode-compatible ChatOpenAI)

    C->>API: SwarmRunRequest task_requirement
    API->>S: asyncio.to_thread(service.run, task_requirement)
    Note over S: Graph built once in SwarmGraphService.__init__
    S->>G: invoke(initial state)
    Note over G: initial: task_requirement, architecture_draft

    G->>D: state slice
    D->>LLM: invoke(messages)
    LLM-->>D: assistant text
    Note over D: assistant_text + json_object_from_text<br/>ArchitectureDraft.model_validate
    D-->>G: partial update architecture_json, component_list

    G->>SC: merged state
    SC->>LLM: with_structured_output(ComplexityOutput).invoke
    LLM-->>SC: parsed ComplexityOutput
    SC-->>G: partial update complexity_score, diagram_plan, doc_plan

    G-->>S: full merged dict (GlobalSwarmState keys)
    S-->>API: dict
    API->>API: SwarmRunResponse.model_validate(result)
    API-->>C: JSON response
```

---

### 2. LangGraph structure (nodes and edges only)

This mirrors `GraphBuilder.build_graph()` in `app/agent/run.py`: a single linear graph, no branches.

```mermaid
flowchart LR
    START([__start__]) --> draft["draft_architecture_node<br/>LeadArchitect.draft_architecture_node"]
    draft --> score["score_complexity_node<br/>ComplexityAnalyzer.score_complexity_node"]
    score --> END([__end__])
```

If you prefer the “state box” style (what each step reads/writes at a high level):

```mermaid
flowchart TB
    subgraph state["GlobalSwarmState (merged as you go)"]
        direction TB
        T[task_requirement]
        AD[architecture_draft]
        AJ[architecture_json]
        CL[component_list]
        CS[complexity_score]
        DP[diagram_plan]
        DOC[doc_plan]
    end

    START([START]) --> N1[draft_architecture_node]
    N1 --> N2[score_complexity_node]
    N2 --> END([END])

    N1 -.->|writes| AJ
    N1 -.->|writes| CL
    N2 -.->|reads| AJ
    N2 -.->|reads| CL
    N2 -.->|writes| CS
    N2 -.->|writes| DP
    N2 -.->|writes| DOC
```

`architecture_draft` is still on the TypedDict but the current nodes do not populate it in the snippets you have; the HTTP layer still returns it via `SwarmRunResponse`.

---

If you want these saved as `.md` in the repo or tweaked (e.g. only sequence, only graph), say what you prefer—Ask mode here, so I can’t write files unless you switch to Agent mode.
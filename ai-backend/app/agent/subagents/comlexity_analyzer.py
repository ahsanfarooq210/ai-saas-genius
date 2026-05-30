from app.agent.state.schema import ArchitectGraphState
from app.agent.subagents._schema import ComplexityOutput
from app.core.llm import get_chat_llm

_llm = get_chat_llm()
_structured_llm = _llm.with_structured_output(ComplexityOutput)

_SYSTEM_PROMPT = """\
You are a software complexity analyst.
Given an architecture, score its complexity and decide which diagrams and docs to generate.
 
Scoring guide:
  1–3: simple / monolith / 2-tier (≤4 components)
       → diagram_plan: ["overview"] + component slugs only
       → doc_plan:     ["overview.md"] + component slugs only
 
  4–6: microservices (5–8 components)
       → diagram_plan: overview + all component slugs + 1–2 cross-cutting diagrams
       → doc_plan:     overview + all component slugs
 
  7–10: distributed / 9+ components
       → diagram_plan: overview + all component slugs + several cross-cutting diagrams
       → doc_plan:     overview + all component slugs + ADRs + runbooks
 
Component slug rules:
  - Lowercase the component name
  - Replace spaces with hyphens
  - Prefix with "component-"
  - Example: "API Gateway" → "component-api-gateway"
  - Use the exact same slugs in both diagram_plan and doc_plan
 
Cross-cutting diagram vocabulary (use only these):
  auth-flow, db-schema, infra, data-pipeline, api-contracts, event-flow, deployment
"""


class ComplexityAnalyzer:
    def score_complexity_node(self, state: ArchitectGraphState) -> dict:
        print(f"\n[complexity_analyzer] scoring {len(state['component_list'])} components")

        prompt = (
            f"Architecture components: {state['component_list']}\n\n"
            f"Architecture details:\n{state['architecture_json']}"
        )

        result: ComplexityOutput = _structured_llm.invoke(
            [
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ]
        )

        print(
            f"[complexity_analyzer] score={result.complexity_score} "
            f"diagrams={len(result.diagram_plan)} docs={len(result.doc_plan)}"
        )

        return {
            "complexity_score": result.complexity_score,
            "diagram_plan": result.diagram_plan,
            "doc_plan": result.doc_plan,
        }

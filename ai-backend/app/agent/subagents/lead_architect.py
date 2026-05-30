from app.agent.state.schema import GlobalSwarmState
from app.agent.subagents._schema import ArchitectureOutput
from app.core.llm import get_chat_llm

_llm = get_chat_llm()
_structured_llm = _llm.with_structured_output(ArchitectureOutput)

_SYSTEM = """\
You are a solutions architect. From the requirement, define 3–12 concrete components
(API Gateway, Auth Service, MongoDB, etc.).

For each component provide:
- A short unique name (used as the key in architecture_json)
- A one-line description
- relations: exact names of other components it depends on, or []

component_list must list every component name in architecture_json (same names, any order).

current_architecture_mermaid must be a valid Mermaid flowchart (flowchart TD) showing every
component in component_list as a node and dependency edges between them.
"""


def _rejection_context(state: GlobalSwarmState) -> str:
    parts: list[str] = []
    scalability = state.get("scalability_feedback", "")
    security = state.get("security_feedback", "")
    if scalability and "REJECTED" in scalability:
        parts.append(f"## Scalability review (must address)\n{scalability}")
    if security and "REJECTED" in security:
        parts.append(f"## Security review (must address)\n{security}")
    if not parts:
        return ""
    return (
        "\n\n---\nPrior reviewer rejections — revise the architecture to fix these:\n\n"
        + "\n\n".join(parts)
    )


class LeadArchitect:
    def draft_architecture_node(self, state: GlobalSwarmState) -> dict:
        print(
            f"\n[lead_architect] drafting architecture for: {state['task_requirement']!r}"
        )

        user_content = state["task_requirement"] + _rejection_context(state)

        result: ArchitectureOutput = _structured_llm.invoke(
            [
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": user_content},
            ]
        )

        print(
            f"[lead_architect] {len(result.component_list)} components, "
            f"mermaid={len(result.current_architecture_mermaid)} chars"
        )

        architecture_json = {
            name: {
                "description": detail.description,
                "relations": list(detail.relations),
            }
            for name, detail in result.architecture_json.items()
        }
        component_list = list(result.component_list) or list(architecture_json.keys())

        update: dict = {
            "architecture_json": architecture_json,
            "component_list": component_list,
            "current_architecture_mermaid": result.current_architecture_mermaid,
        }
        if _rejection_context(state):
            update["scalability_feedback"] = ""
            update["security_feedback"] = ""
            update["docs_complete"] = False
        return update

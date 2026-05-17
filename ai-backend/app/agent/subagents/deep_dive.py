from app.agent.state.schema import GlobalSwarmState
from app.agent.subagents.llm_reply import assistant_text
from app.core.llm import get_chat_llm

_llm = get_chat_llm()

_SYSTEM_PROMPT = """\
You are a senior architect reviewing a complex distributed system.
Given an architecture, produce:
1. The top 3 risks or failure modes to address
2. The top 3 open questions a team must answer before building
3. Any cross-cutting concerns (auth, observability, data consistency)

Be specific and concise. Output plain text.
"""


class DeepDive:
    def deep_dive_node(self, state: GlobalSwarmState) -> dict:
        print(f"\n[deep_dive] running — complexity_score={state['complexity_score']}")

        prompt = (
            f"Components: {state['component_list']}\n\n"
            f"Architecture:\n{state['architecture_json']}"
        )

        response = _llm.invoke(
            [
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ]
        )

        return {"deep_dive_notes": assistant_text(response)}

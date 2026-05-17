from app.agent.state.schema import GlobalSwarmState
from app.core.llm import get_chat_llm


_llm = get_chat_llm()


_SYSTEM_PROMPT = """\
You are a technical writer. Summarize the architecture analysis in 3–5 bullet points.
If deep dive notes are present, include the key risks at the end.
Be concise — this is an executive summary.
"""


def summarize_node(state: GlobalSwarmState) -> dict:
    print(f"\n[summarize] producing final summary")

    prompt = (
        f"Components: {state['component_list']}\n"
        f"Complexity score: {state['complexity_score']}\n"
        f"Diagram plan: {state['diagram_plan']}\n\n"
        f"Deep dive notes:\n{state.get('deep_dive_notes') or 'None — simple system'}"
    )

    response = _llm.invoke(
        [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ]
    )

    print(f"\n── Summary ──────────────────────────────────────────")
    print(response.content)

    # summarize_node doesn't write new state fields —
    # it's a terminal display node. Returning empty dict is valid.
    return {}

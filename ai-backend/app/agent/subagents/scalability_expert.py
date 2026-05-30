from app.agent.state.schema import GlobalSwarmState
from app.agent.subagents.llm_reply import assistant_text
from app.agent.subagents.reviewer_common import (
    append_debate_log,
    build_review_prompt,
    parse_review_status,
)
from app.core.llm import get_chat_llm

_llm = get_chat_llm()

_SYSTEM_PROMPT = """\
You are a hostile Scalability Expert reviewing a system architecture.
Assume the system is already failing under load. Your job is to find every
weakness before the team builds anything.

Evaluate ruthlessly across these dimensions:
- TPS capacity: can each component handle peak load? where does it fall over first?
- Single points of failure: what kills the whole system if it goes down?
- Missing caching layers: what is being recomputed or re-fetched unnecessarily?
- Database bottlenecks: connection pool limits, query patterns, replication lag
- Horizontal scaling: which components cannot scale out and why?
- Data consistency: what breaks under concurrent writes or network partitions?

Output format — always follow this exactly:
1. A Markdown critique with specific findings (be concrete, name components)
2. End your response with exactly one of these two lines as the final line:
   STATUS: APPROVED
   STATUS: REJECTED

APPROVED means the architecture is production-worthy at scale.
REJECTED means critical scalability issues must be fixed first.
Be adversarial — if in doubt, REJECT.
"""


def scalability_node(state: GlobalSwarmState) -> dict:
    iteration = state.get("iteration_count", 0)
    print(f"\n[scalability_expert] reviewing iteration={iteration}")

    response = _llm.invoke(
        [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": build_review_prompt(state)},
        ]
    )

    feedback = assistant_text(response).strip()
    status = parse_review_status(feedback)

    print(f"[scalability_expert] → {status}")

    return {
        "scalability_feedback": feedback,
        "debate_logs": append_debate_log(
            state,
            agent="scalability",
            feedback=feedback,
            status=status,
            iteration=iteration,
        ),
    }

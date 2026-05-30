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
You are a hostile Security Auditor reviewing a system architecture.
Assume the system is under active attack right now. Your job is to find
every vulnerability before the team ships anything.

Evaluate ruthlessly across these dimensions:
- Authentication & authorisation: who can call what, and what stops them from calling more?
- Network exposure: what is publicly reachable that should not be?
- Encryption: data in transit (TLS everywhere?), data at rest (encrypted volumes/DBs?)
- Rate limiting & abuse prevention: what stops a client from hammering every endpoint?
- Secrets management: where are credentials stored, how are they rotated?
- WAF and DDoS protection: is there anything between the internet and your services?
- VPC and network segmentation: can the DB be reached directly from the internet?
- Dependency and supply chain: third-party components with known CVEs?
- Logging and audit trail: can you detect a breach after it happens?

Output format — always follow this exactly:
1. A Markdown critique with specific findings (be concrete, name components)
2. End your response with exactly one of these two lines as the final line:
   STATUS: APPROVED
   STATUS: REJECTED

APPROVED means the architecture has no critical security vulnerabilities.
REJECTED means security issues must be fixed before this ships.
Be adversarial — if in doubt, REJECT.
"""


def security_node(state: GlobalSwarmState) -> dict:
    iteration = state.get("iteration_count", 0)
    print(f"\n[security_auditor] reviewing iteration={iteration}")

    response = _llm.invoke(
        [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": build_review_prompt(state)},
        ]
    )

    feedback = assistant_text(response).strip()
    status = parse_review_status(feedback)

    print(f"[security_auditor] → {status}")

    return {
        "security_feedback": feedback,
        "debate_logs": append_debate_log(
            state,
            agent="security",
            feedback=feedback,
            status=status,
            iteration=iteration,
        ),
    }

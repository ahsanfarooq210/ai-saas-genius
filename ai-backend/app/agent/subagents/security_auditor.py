from app.agent.state.schema import GlobalSwarmState


def security_node(state: GlobalSwarmState) -> dict:
    """
    Phase 9 stub — always approves.
    Phase 10 replaces the body with a real adversarial review.
    The node slot, return key, and STATUS format never change.
    """
    print("\n[security_auditor] STUB — returning APPROVED")

    return {"security_feedback": "STATUS: APPROVED"}

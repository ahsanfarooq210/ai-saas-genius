"""Shared parsing for scalability/security review outputs."""

from __future__ import annotations

from typing import Literal


def terminal_review_status(
    feedback: str,
) -> Literal["approved", "rejected", "pending"]:
    """
    Resolve APPROVED vs REJECTED. Prefer standalone STATUS lines (normalized
    reviewer output); fall back to substring checks. Ambiguous or missing
    status → pending (caller should re-run review).
    """
    if not (feedback or "").strip():
        return "pending"

    for line in reversed(feedback.strip().splitlines()):
        s = line.strip()
        if s == "STATUS: APPROVED":
            return "approved"
        if s == "STATUS: REJECTED":
            return "rejected"

    has_approve = "STATUS: APPROVED" in feedback
    has_reject = "STATUS: REJECTED" in feedback
    if has_approve and has_reject:
        return "rejected"
    if has_approve:
        return "approved"
    if has_reject:
        return "rejected"
    return "pending"


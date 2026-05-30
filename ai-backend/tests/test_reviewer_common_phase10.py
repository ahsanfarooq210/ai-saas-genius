"""Phase 10 reviewer helpers — unit tests (no LLM)."""

from app.agent.subagents.reviewer_common import parse_review_status


def test_parse_status_approved() -> None:
    assert parse_review_status("Findings...\n\nSTATUS: APPROVED") == "APPROVED"


def test_parse_status_rejected() -> None:
    assert parse_review_status("Findings...\n\nSTATUS: REJECTED") == "REJECTED"


def test_parse_status_defaults_to_rejected() -> None:
    assert parse_review_status("Looks good to me.") == "REJECTED"


def test_parse_status_last_line_wins() -> None:
    assert (
        parse_review_status("Earlier REJECTED\n\nSTATUS: APPROVED but REJECTED earlier")
        == "APPROVED"
    )

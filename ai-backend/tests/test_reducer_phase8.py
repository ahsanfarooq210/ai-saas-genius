"""Phase 8: generated_docs reducer and doc filename slug pairing."""

from typing import Annotated, get_args, get_origin, get_type_hints
import operator

from app.agent.state.schema import DocEntry, GlobalSwarmState
from app.agent.subagents.doc_planner import slug_from_doc_filename


def test_global_swarm_state_uses_reducer_for_generated_docs() -> None:
    hints = get_type_hints(GlobalSwarmState, include_extras=True)
    generated_docs = hints["generated_docs"]

    assert get_origin(generated_docs) is Annotated
    assert get_args(generated_docs)[0] == list[DocEntry]
    assert get_args(generated_docs)[1] is operator.add


def test_slug_from_doc_filename() -> None:
    assert slug_from_doc_filename("overview.md") == ""
    assert slug_from_doc_filename("api-gateway.md") == "api-gateway"
    assert slug_from_doc_filename("adr-caching.md") == ""
    assert slug_from_doc_filename("runbook-deploy.md") == ""

"""Supervisor routing — deterministic only; no LLM.

The parent graph (`supervisor_graph`) runs a cyclic loop:

    START → supervisor_node → (worker) → supervisor_node → … → END

Each lap, `supervisor_node` increments `iteration_count`, calls `_route`, and
writes the result to `next_agent`. LangGraph then invokes `supervisor_route`,
which simply returns that field for `add_conditional_edges`.

Workers always edge back to `supervisor_node`, so every completed phase re-enters
the same priority-ordered gate checks on the next lap.
"""

from app.agent.state.schema import GlobalSwarmState

MAX_ITERATIONS = 5


def supervisor_node(state: GlobalSwarmState) -> dict:
    """LangGraph node: one supervisor lap.

    Increments `iteration_count`, picks the next worker via `_route`, and stores
    the choice in `next_agent` (for logging, API visibility, and conditional
    edges). Never calls an LLM and never mutates artifacts.

    Circuit breaker: iteration is incremented *before* routing. Passes
    1..MAX_ITERATIONS call `_route` normally; pass MAX_ITERATIONS + 1 and
    beyond force `"END"` regardless of state. That lets the 5th pass still route
    (e.g. into `doc_generator_graph`) while preventing infinite reject/revise loops.
    """
    iteration = state.get("iteration_count", 0) + 1

    # Allow the MAX_ITERATIONS-th supervisor pass to route normally.
    # Force END only after the run has already consumed that many passes.
    if iteration > MAX_ITERATIONS:
        next_agent = "END"
    else:
        next_agent = _route(state)

    print(f"\n[supervisor] iteration={iteration} → routing to: {next_agent}")

    return {
        "iteration_count": iteration,
        "next_agent": next_agent,
    }


def _route(state: GlobalSwarmState) -> str:
    """Decide which graph node runs next from current state.

    Rules are evaluated top to bottom; the first match wins. Each rule is a
    pipeline gate — later stages are unreachable until earlier ones pass.

    Gate order (happy path)
    -----------------------
    1. Architecture   — `component_list` non-empty (filled by `architect_graph`)
    2. Documentation  — `docs_complete` is True (set by `doc_generator_graph`)
    3. Scalability    — `scalability_feedback` non-empty and not rejected
    4. Security       — `security_feedback` non-empty and not rejected
    5. Done           — both reviewers approved → `"END"`

    Reviewer feedback semantics
    ---------------------------
    Reviewer nodes write Markdown into `scalability_feedback` /
    `security_feedback`, ending with `STATUS: APPROVED` or `STATUS: REJECTED`.

    - Empty string (`""`) → review has not run yet → route to that reviewer.
    - Substring `"REJECTED"` anywhere in the text → send back to
      `"architect_graph"` so the architecture can be revised (docs and reviews
      re-run on later laps as gates fail again).
    - Any other non-empty value (typically containing `"APPROVED"`) → gate
      passed; fall through to the next rule.

    Return values map 1:1 to node names in `supervisor_graph.add_conditional_edges`.
    """
    if not state.get("component_list"):
        return "architect_graph"

    if not state.get("docs_complete"):
        return "doc_generator_graph"

    scalability = state.get("scalability_feedback", "")
    if "REJECTED" in scalability:
        return "architect_graph"
    if not scalability:
        return "scalability_node"

    security = state.get("security_feedback", "")
    if "REJECTED" in security:
        return "architect_graph"
    if not security:
        return "security_node"

    return "END"


def supervisor_route(state: GlobalSwarmState) -> str:
    """LangGraph conditional-edge selector for the supervisor node.

    Must stay a thin read of `next_agent`; all routing policy lives in
    `supervisor_node` / `_route` so tests can call `_route` directly without
    simulating LangGraph edge dispatch.
    """
    return state["next_agent"]

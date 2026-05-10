"""TypedDicts — grows phase by phase."""

from typing import TypedDict, Annotated
import operator

class GlobalSwarmState(TypedDict):
    task_requirement: str     # the user's prompt — never mutated after init
    architecture_draft: str   # plain text — placeholder until Phase 2

class ArchitectInternalState(TypedDict):
    draft_mermaid: str              # scratchpad during Mermaid generation
    linter_errors: list[str]        # feedback between linter and generator
    internal_loop_count: int        # lint-fix retry counter; hard limit = 3
    current_diagram_type: str       # which diagram is being worked on right now
"""TypedDicts — grows phase by phase."""

from typing import TypedDict, Annotated
import operator

class GlobalSwarmState(TypedDict):
    task_requirement: str     # the user's prompt — never mutated after init
    architecture_draft: str   # plain text — placeholder until Phase 2
    architecture_json: dict   # structured component map: {component: {description, relations}}
    component_list: list[str]   # ["API Gateway", "Auth Service", "Cache", "DB"]
    complexity_score: int       # 1–10; drives how many diagrams/docs are made
    diagram_plan: list[str]     # ["overview", "component-api-gateway", "auth-flow", ...]
    doc_plan: list[str]         # ["overview.md", "api-gateway.md", "auth-service.md", ...]

class ArchitectInternalState(TypedDict):
    draft_mermaid: str              # scratchpad during Mermaid generation
    linter_errors: list[str]        # feedback between linter and generator
    internal_loop_count: int        # lint-fix retry counter; hard limit = 3
    current_diagram_type: str       # which diagram is being worked on right now
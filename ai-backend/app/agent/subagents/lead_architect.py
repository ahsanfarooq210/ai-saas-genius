import json

from app.agent.state.schema import GlobalSwarmState
from app.agent.subagents._schema import ArchitectureDraft
from app.agent.subagents.llm_reply import assistant_text, json_object_from_text
from app.core.llm import get_chat_llm

_llm = get_chat_llm()

_SYSTEM = """You are a solutions architect. From the requirement, list 3–12 concrete components
(API Gateway, Auth Service, MongoDB, etc.) with a one-line description each and which other
components they depend on (exact names, or []).

Reply with ONLY valid JSON in this exact shape (no markdown outside JSON, or one ```json block):
{"components":[{"name":"...","description":"...","relations":["OtherName"]}]}"""


class LeadArchitect:
    def draft_architecture_node(self, state: GlobalSwarmState) -> dict:
        print(f"\n[lead_architect] drafting architecture for: {state['task_requirement']!r}")

        msg = _llm.invoke(
            [
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": state["task_requirement"]},
            ]
        )
        raw = assistant_text(msg)
        try:
            data = json_object_from_text(raw)
            # Some models nest as {"architecture_json": {"components": [...]}}
            inner = data.get("architecture_json")
            if "components" not in data and isinstance(inner, dict) and "components" in inner:
                data = {"components": inner["components"]}
            draft = ArchitectureDraft.model_validate(data)
        except (json.JSONDecodeError, ValueError) as e:
            raise ValueError(
                f"Expected JSON with a 'components' array. Reply started: {raw[:400]!r}"
            ) from e

        return {
            "architecture_json": {
                c.name: {"description": c.description, "relations": list(c.relations)}
                for c in draft.components
            },
            "component_list": [c.name for c in draft.components],
        }


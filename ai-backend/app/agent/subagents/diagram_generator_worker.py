from app.agent.state.schema import DiagramEntry, DiagramWorkerState
from app.agent.storage.file_store import artifact_store
from app.agent.subagents.llm_reply import assistant_text
from app.agent.tools.mermaid_linter import mermaid_linter
from app.core.llm import get_chat_llm

_llm = get_chat_llm()

_MAX_LINT_ATTEMPTS = 3

_SYSTEM_PROMPT = """\
You are an expert at creating Mermaid diagrams for software architecture.
Generate a single valid Mermaid diagram for the requested diagram type.

Rules:
- Always start with a valid declaration: flowchart TD, sequenceDiagram, etc.
- Every node must have a label inside [] or () or {}
- No empty labels
- Keep it focused — show only what is relevant to this specific diagram type
- For component diagrams: show that component, its direct dependencies, and interfaces
- For overview: show all components and their primary relationships
- Return only the Mermaid source — no markdown fences, no explanation
"""


class DiagramGenerator:
    @staticmethod
    def _strip_code_fences(text: str) -> str:
        stripped = text.strip()
        if not stripped.startswith("```"):
            return stripped
        return "\n".join(
            line for line in stripped.split("\n") if not line.strip().startswith("```")
        ).strip()

    @staticmethod
    def _entry_update(
        state: DiagramWorkerState,
        *,
        storage_key: str,
        url: str,
    ) -> dict:
        return {
            "generated_diagrams": [
                DiagramEntry(
                    diagram_type=state["diagram_type"],
                    component_slug=state["component_slug"],
                    storage_key=storage_key,
                    url=url,
                    iteration=state["iteration"],
                )
            ]
        }

    def diagram_generator_node(self, state: DiagramWorkerState) -> dict:
        """
        One parallel worker per diagram_plan entry.
        Returns a partial GlobalSwarmState update (single DiagramEntry via reducer).
        """
        diagram_type = state["diagram_type"]
        print(f"\n[diagram_generator] generating: {diagram_type}")

        prompt = (
            f"Generate a Mermaid diagram for: {diagram_type}\n\n"
            f"Architecture components: {list(state['architecture_json'].keys())}\n\n"
            f"Architecture details:\n{state['architecture_json']}\n\n"
            f"System requirement: {state['task_requirement']}\n\n"
            "Latest revision instruction: "
            f"{state.get('revision_instruction') or '(initial generation)'}"
        )

        messages: list[dict[str, str]] = [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ]

        for attempt in range(_MAX_LINT_ATTEMPTS):
            response = _llm.invoke(messages)
            raw_text = assistant_text(response).strip()
            diagram_text = self._strip_code_fences(raw_text)

            lint_result = mermaid_linter.invoke({"diagram": diagram_text})

            if lint_result == "OK":
                print(
                    f"[diagram_generator] ✓ {diagram_type} valid "
                    f"(attempt {attempt + 1})"
                )
                stored = artifact_store.upload_diagram(
                    thread_id=state["thread_id"],
                    revision_number=state.get("revision_number", 1),
                    iteration=state["iteration"],
                    diagram_type=state["diagram_type"],
                    content=diagram_text,
                )
                return self._entry_update(
                    state,
                    storage_key=stored.storage_key,
                    url=stored.url,
                )

            print(
                f"[diagram_generator] ✗ {diagram_type} "
                f"attempt {attempt + 1}: {lint_result}"
            )

            # Providers (e.g. Moonshot) reject empty assistant messages on retry.
            assistant_turn = raw_text or diagram_text or "(no diagram content returned)"
            messages.append({"role": "assistant", "content": assistant_turn})
            messages.append(
                {
                    "role": "user",
                    "content": (
                        "The diagram has errors. Fix them and return only the "
                        "corrected Mermaid diagram with no explanation.\n\n"
                        f"Errors:\n{lint_result}"
                    ),
                }
            )

        print(
            f"[diagram_generator] ✗ {diagram_type} "
            f"failed after {_MAX_LINT_ATTEMPTS} attempts"
        )
        return self._entry_update(state, storage_key="", url="")

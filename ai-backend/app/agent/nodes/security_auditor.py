from langchain_core.prompts import ChatPromptTemplate
from app.agent.review_parsing import terminal_review_status
from app.agent.state.global_swarm_state import GlobalSwarmState
from app.agent.llm import llm_gemini

SECURITY_PROMPT = """
You are a hostile security auditor. Assume the system described below is already
under active attack. Your job is to find every security gap — missing WAFs,
exposed databases, absent rate limiting, unencrypted data at rest or in transit,
VPC misconfigurations, and zero-trust violations.

Architecture JSON:
{architecture_json}

Generated Diagrams:
{diagrams}

Generated Documents:
{docs}

Previous security feedback (if any):
{previous_feedback}

Write a detailed Markdown critique. Be adversarial. Do not give the benefit of
the doubt on anything ambiguous — flag it.

End your response with exactly one of these two lines:
STATUS: APPROVED
STATUS: REJECTED
"""


async def security_node(state: GlobalSwarmState) -> dict:
    diagrams_text = (
        "\n\n".join(
            [
                f"### {d['diagram_type']}\n```\n{d['content']}\n```"
                for d in state.get("generated_diagrams", [])
            ]
        )
        or "No diagrams generated yet."
    )

    docs_text = (
        "\n\n".join(
            [f"### {d['title']}\n{d['content']}" for d in state.get("generated_docs", [])]
        )
        or "No documents generated yet."
    )

    prompt = ChatPromptTemplate.from_template(SECURITY_PROMPT)
    chain = prompt | llm_gemini

    response = await chain.ainvoke(
        {
            "architecture_json": state.get("architecture_json", {}),
            "diagrams": diagrams_text,
            "docs": docs_text,
            "previous_feedback": state.get("security_feedback", "None"),
        }
    )

    feedback = response.content

    status = terminal_review_status(feedback)
    label = "APPROVED" if status == "approved" else "REJECTED"

    normalized_feedback = (
        feedback.replace("STATUS: APPROVED", "").replace("STATUS: REJECTED", "").strip()
    )
    final_feedback = f"{normalized_feedback}\n\n---\n\nSTATUS: {label}"

    return {"security_feedback": final_feedback}

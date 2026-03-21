from app.agent.llm import llm_gemini
from langchain_core.prompts import ChatPromptTemplate
from app.agent.state.global_swarm_state import GlobalSwarmState

llm  = llm_gemini

SCALABILITY_PROMPT = """
You are a hostile scalability expert and performance engineer. Your job is to
stress-test the architecture described below by playing devil's advocate on
every design decision. Assume this system will receive 10x the expected traffic
on day one. Find every bottleneck, every single point of failure, every database
that will lock under load, and every service that has no horizontal scaling path.

Architecture JSON:
{architecture_json}

Generated Diagrams:
{diagrams}

Generated Documents:
{docs}

Previous scalability feedback (if any):
{previous_feedback}

Your critique must cover ALL of the following — skip none:

1. **Single Points of Failure (SPOF)**: Every component with no redundancy.
2. **TPS Estimations**: Estimate realistic transactions per second for each
   critical path. Flag any component that cannot sustain the estimated TPS.
3. **Database Bottlenecks**: Connection pool limits, missing read replicas,
   absent sharding strategy, hot partitions, N+1 query risks.
4. **Caching Gaps**: Any high-read path with no caching layer. Missing CDN,
   missing Redis/Memcached, missing query result caching.
5. **Async vs Sync**: Any synchronous call that should be async. Missing
   message queues, missing background job processors.
6. **Horizontal Scaling Blockers**: Any stateful service that cannot scale
   horizontally. Sticky sessions, in-memory state, missing load balancer config.
7. **Network & Latency**: Cross-region latency not accounted for, missing
   connection pooling, chatty inter-service communication.

Write your full critique in Markdown. Use headers for each section above.
Be adversarial and specific — do not give vague warnings. Reference specific
components from the architecture by name.

If the architecture adequately addresses all of the above concerns, you may
approve it. If any critical issue remains unresolved, reject it.

End your response with exactly one of these two lines on its own line:
STATUS: APPROVED
STATUS: REJECTED
"""


async def scalability_node(state: GlobalSwarmState) -> dict:
    # Serialize all diagrams into readable text for the prompt
    diagrams_text = (
        "\n\n".join(
            [
                f"### {d['diagram_type'].replace('-', ' ').title()}\n```\n{d['content']}\n```"
                for d in state.get("generated_diagrams", [])
                if d["content"] != "syntax_error"  # skip diagrams that failed linting
            ]
        )
        or "No diagrams generated yet."
    )

    # Serialize all docs into readable text for the prompt
    docs_text = (
        "\n\n".join(
            [
                f"### {d['title']}\n{d['content']}"
                for d in state.get("generated_docs", [])
            ]
        )
        or "No documents generated yet."
    )

    prompt = ChatPromptTemplate.from_template(SCALABILITY_PROMPT)
    chain = prompt | llm

    response = await chain.ainvoke(
        {
            "architecture_json": state.get("architecture_json", {}),
            "diagrams": diagrams_text,
            "docs": docs_text,
            "previous_feedback": state.get("scalability_feedback")
            or "None — this is the first review.",
        }
    )

    feedback = response.content

    # Parse STATUS — default to REJECTED if the model forgot to include it
    if "STATUS: APPROVED" in feedback:
        status = "APPROVED"
    elif "STATUS: REJECTED" in feedback:
        status = "REJECTED"
    else:
        status = (
            "REJECTED"  # safe default — never silently approve a malformed response
        )

    # Strip the raw STATUS line and re-attach in a normalized format
    normalized = (
        feedback.replace("STATUS: APPROVED", "").replace("STATUS: REJECTED", "").strip()
    )
    final_feedback = f"{normalized}\n\n---\n\nSTATUS: {status}"

    return {"scalability_feedback": final_feedback}

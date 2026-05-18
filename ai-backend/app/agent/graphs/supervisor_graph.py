"""Parent topology. Phase 5: architect sub-graph only; full routing in Phase 9."""

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

from app.agent.graphs.architect_graph import architect_graph
from app.agent.state.schema import GlobalSwarmState


class SupervisorGraph:
    """Parent graph — sub-graphs register as opaque nodes; owns the checkpointer."""

    def build(self):
        builder = StateGraph(GlobalSwarmState)

        builder.add_node("architect_graph", architect_graph)

        builder.add_edge(START, "architect_graph")
        builder.add_edge("architect_graph", END)

        return builder.compile(checkpointer=MemorySaver())


supervisor_graph = SupervisorGraph().build()

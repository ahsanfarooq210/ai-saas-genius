# Graph docs

This section explains the live LangGraph runtime from the code that is currently wired.

Read in this order:

1. [overview.md](overview.md) - how the parent graph, subgraphs, service, API, checkpoints, and app tables work together.
2. [supervisor-graph.md](supervisor-graph.md) - parent graph, deterministic routing, reviewer loop, and iteration cap.
3. [architect-subgraph.md](architect-subgraph.md) - architecture drafting, complexity scoring, diagram fan-out, and diagram reduction.
4. [doc-generator-subgraph.md](doc-generator-subgraph.md) - documentation fan-out, diagram pairing, doc artifact storage, and doc reduction.

Deeper historical flow notes still live in [`../flows/`](../flows/). Those files are useful when changing reducer behavior or tracing how the graph evolved, but this folder is the cleaner runtime reference.


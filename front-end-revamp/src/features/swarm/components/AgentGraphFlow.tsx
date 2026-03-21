import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";

const nodes: Node[] = [
  {
    id: "supervisor",
    data: { label: "Supervisor" },
    position: { x: 0, y: 0 },
    style: {
      background: "#18181b",
      color: "#f4f4f5",
      border: "1px solid #3f3f46",
      borderRadius: 4,
      fontSize: 12,
      padding: 4,
      width: 110,
    },
  },
  {
    id: "architect",
    data: { label: "Architect" },
    position: { x: -150, y: 90 },
    style: {
      background: "#18181b",
      color: "#f4f4f5",
      border: "1px solid #3f3f46",
      borderRadius: 4,
      fontSize: 12,
      padding: 4,
      width: 110,
    },
  },
  {
    id: "scalability",
    data: { label: "Scalability" },
    position: { x: 0, y: 90 },
    style: {
      background: "#18181b",
      color: "#f4f4f5",
      border: "1px solid #3f3f46",
      borderRadius: 4,
      fontSize: 12,
      padding: 4,
      width: 110,
    },
  },
  {
    id: "security",
    data: { label: "Security" },
    position: { x: 150, y: 90 },
    style: {
      background: "#18181b",
      color: "#f4f4f5",
      border: "1px solid #3f3f46",
      borderRadius: 4,
      fontSize: 12,
      padding: 4,
      width: 110,
    },
  },
];

const edges: Edge[] = [
  { id: "s-a", source: "supervisor", target: "architect", animated: true, style: { stroke: "#0ea5e9" } },
  { id: "s-sc", source: "supervisor", target: "scalability", animated: true, style: { stroke: "#0ea5e9" } },
  { id: "s-se", source: "supervisor", target: "security", animated: true, style: { stroke: "#0ea5e9" } },
];

export const AgentGraphFlow = () => {
  return (
    <div className="h-44 overflow-hidden rounded-sm border border-zinc-800 bg-zinc-900/40">
      <ReactFlow nodes={nodes} edges={edges} fitView fitViewOptions={{ padding: 0.2 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} panOnDrag={false} zoomOnScroll={false} zoomOnPinch={false} zoomOnDoubleClick={false}>
        <Background color="#27272a" gap={16} />
        <MiniMap zoomable pannable nodeColor="#18181b" maskColor="rgba(0,0,0,0.3)" />
        <Controls showInteractive={false} className="bg-zinc-900!" />
      </ReactFlow>
    </div>
  );
};

export type AgentState = "idle" | "active" | "approved" | "rejected";

export type SessionStatus = "idle" | "running" | "paused" | "complete" | "failed";

export interface DiagramEntry {
  diagram_type: string;
  mermaid_code: string;
  components_count?: number;
  updated_at: string;
}

export interface DocEntry {
  title: string;
  doc_type: string;
  content: string;
  size_bytes?: number;
}

export interface DebateEntry {
  id: string;
  agent: "scalability" | "security";
  iteration: number;
  markdown: string;
  status: "APPROVED" | "REJECTED";
  created_at: string;
}

export interface AgentCardState {
  state: AgentState;
  model: string;
  currentTask: string;
  lastIteration: number;
}

export interface GlobalSwarmState {
  thread_id: string;
  requirement: string;
  iteration_count: number;
  max_iterations: number;
  complexity_score: number;
  architecture_json: Record<string, unknown> | null;
  generated_diagrams: DiagramEntry[];
  generated_docs: DocEntry[];
  debate_log: DebateEntry[];
  doc_plan: string[];
  diagram_plan: string[];
  scalability_feedback: string;
  security_feedback: string;
  status: SessionStatus;
}

export type SwarmStateDiff = Partial<GlobalSwarmState>;

export interface SwarmSsePayload {
  node: string;
  state_diff: SwarmStateDiff;
  type?: string;
  message?: string;
}

export interface SessionSnapshot {
  iterationCount: number;
  maxIterations: number;
  complexityScore: number | null;
  generatedDiagrams: DiagramEntry[];
  generatedDocs: DocEntry[];
  debateLog: DebateEntry[];
  docPlan: string[];
  diagramPlan: string[];
  architectureJson: Record<string, unknown> | null;
}

export interface SessionHistoryItem {
  threadId: string;
  requirement: string;
  createdAt: string;
  complexityScore: number | null;
  status: "Running" | "Complete" | "Failed";
  diagramsCount: number;
  docsCount: number;
  snapshot?: SessionSnapshot;
}

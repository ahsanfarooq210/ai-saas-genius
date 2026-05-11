export type AgentState = "idle" | "active" | "approved" | "rejected";

export type SessionStatus = "idle" | "running" | "paused" | "complete" | "failed";

export interface DiagramEntry {
  diagram_type: string;
  content: string;
  path: string;
  url: string;
  iteration: number;
  upload_error?: string;
}

export interface DocEntry {
  title: string;
  content: string;
  path: string;
  url: string;
  upload_error?: string;
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
  user_id: string | null;
  iteration_count: number;
  docs_complete: boolean;
  next_agent: string;
  current_architecture_mermaid: string;
  complexity_score: number;
  architecture_json: Record<string, unknown>;
  component_list: string[];
  generated_diagrams: DiagramEntry[];
  generated_docs: DocEntry[];
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
  threadId: string;
  userId: string | null;
  requirement: string;
  iterationCount: number;
  docsComplete: boolean;
  nextAgent: string;
  currentArchitectureMermaid: string;
  complexityScore: number | null;
  componentList: string[];
  generatedDiagrams: DiagramEntry[];
  generatedDocs: DocEntry[];
  docPlan: string[];
  diagramPlan: string[];
  architectureJson: Record<string, unknown>;
  scalabilityFeedback: string;
  securityFeedback: string;
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

export interface SwarmRunRequest {
  task_requirement: string;
  thread_id?: string | null;
  user_id?: string | null;
}

export interface SwarmRunResponse {
  thread_id: string;
  user_id: string | null;
  task_requirement: string;
  iteration_count: number;
  docs_complete: boolean;
  next_agent: string;
  current_architecture_mermaid: string;
  architecture_json: Record<string, unknown>;
  component_list: string[];
  complexity_score: number;
  diagram_plan: string[];
  doc_plan: string[];
  generated_diagrams: DiagramEntry[];
  generated_docs: DocEntry[];
  scalability_feedback: string;
  security_feedback: string;
}

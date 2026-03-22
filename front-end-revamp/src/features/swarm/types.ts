export type AgentState = "idle" | "active" | "approved" | "rejected";

export type SessionStatus = "idle" | "starting" | "running" | "complete" | "failed";

export type SwarmStage =
  | "idle"
  | "starting"
  | "running:architect"
  | "running:doc_generator"
  | "running:scalability"
  | "running:security"
  | "complete"
  | "error";

export type ReviewVerdict = "APPROVED" | "REJECTED";

export type WorkItemStatus = "pending" | "generating" | "done" | "failed";

export interface DiagramEntry {
  diagram_type: string;
  path?: string;
  status: WorkItemStatus;
}

export interface DocEntry {
  doc_slug: string;
  title?: string;
  path?: string;
  status: Exclude<WorkItemStatus, "failed">;
}

export interface AgentCardState {
  state: AgentState;
  model: string;
  currentTask: string;
  lastIteration: number;
}

export interface SessionSnapshot {
  stage: SwarmStage;
  phaseLabel: string;
  iterationCount: number;
  maxIterations: number;
  complexityScore: number | null;
  componentList: string[];
  diagramPlan: string[];
  docPlan: string[];
  totalDiagrams: number;
  completedDiagrams: number;
  totalDocs: number;
  completedDocs: number;
  generatedDiagrams: DiagramEntry[];
  generatedDocs: DocEntry[];
  scalabilityVerdict: ReviewVerdict | null;
  securityVerdict: ReviewVerdict | null;
  timeoutMessage: string | null;
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

export interface StartSwarmResponse {
  thread_id: string;
}

export interface SupervisorEventPayload {
  status?: "routing" | "circuit_breaker_triggered";
  next?: "architect" | "doc_generator" | "scalability" | "security" | "end";
  message?: string;
  iteration?: number;
  complexity_score?: number | null;
  diagram_count?: number;
  doc_plan?: string[];
}

export interface ArchitectEventPayload {
  status?: "started" | "architecture_ready";
  message?: string;
  complexity_score?: number;
  component_list?: string[];
  diagram_plan?: string[];
  doc_plan?: string[];
  diagram_count_planned?: number;
}

export interface DocPlannerEventPayload {
  status?: "planning" | "plan_ready";
  message?: string;
  complexity_score?: number;
  doc_plan?: string[];
  doc_count?: number;
}

export interface DocGeneratorEventPayload {
  status?: "generating" | "doc_complete";
  message?: string;
  doc_slug?: string;
  thread_id?: string;
  title?: string;
  path?: string;
  completed_docs?: number;
  total_docs?: number;
}

export interface DiagramGeneratorEventPayload {
  status?: "generating" | "diagram_complete" | "diagram_failed";
  message?: string;
  diagram_type?: string;
  path?: string;
  completed_diagrams?: number;
  total_diagrams?: number;
}

export interface ReviewEventPayload {
  status?: "reviewing" | "review_complete";
  message?: string;
  diagram_count?: number;
  doc_count?: number;
  verdict?: ReviewVerdict;
  iteration?: number;
}

export interface DoneEventPayload {
  status?: "complete";
  complexity_score?: number;
  iteration_count?: number;
  diagram_count?: number;
  doc_count?: number;
  diagrams?: Array<{ type: string; path: string }>;
  docs?: Array<{ title: string; path: string }>;
  scalability_verdict?: ReviewVerdict;
  security_verdict?: ReviewVerdict;
}

export type SwarmEventPayload =
  | SupervisorEventPayload
  | ArchitectEventPayload
  | DocPlannerEventPayload
  | DocGeneratorEventPayload
  | DiagramGeneratorEventPayload
  | ReviewEventPayload
  | DoneEventPayload;

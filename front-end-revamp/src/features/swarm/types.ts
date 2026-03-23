export type SessionStatus = "idle" | "starting" | "running" | "complete" | "failed";

export type SwarmStage = "idle" | "starting" | "running" | "complete" | "error";

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

export interface SessionSnapshot {
  stage: SwarmStage;
  currentStage: string | null;
  currentTask: string | null;
  progressMessage: string | null;
  activeItemType: string | null;
  activeItemName: string | null;
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
  scalabilityFeedback: string | null;
  securityFeedback: string | null;
  architectureJson: Record<string, unknown> | null;
  currentArchitectureMermaid: string | null;
  timeoutMessage: string | null;
  rawState: Record<string, unknown>;
  progressFeed: ProgressFeedItem[];
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

export interface ProgressFeedItem {
  id: string;
  timestamp: string;
  event?: string;
  type?: string;
  stage?: string;
  status?: string;
  message?: string;
  payload: Record<string, unknown>;
}

export interface AgentStatePatch {
  thread_id?: string;
  user_id?: string;
  task_requirement?: string;
  iteration_count?: number;
  docs_complete?: boolean;
  next_agent?: string;
  current_architecture_mermaid?: string;
  architecture_json?: Record<string, unknown> | null;
  component_list?: string[];
  complexity_score?: number | null;
  diagram_plan?: string[];
  doc_plan?: string[];
  generated_diagrams?: unknown[];
  generated_docs?: unknown[];
  scalability_feedback?: unknown;
  security_feedback?: unknown;
  current_stage?: string;
  current_task?: string;
  progress_message?: string;
  active_item_type?: string;
  active_item_name?: string;
  completed_diagram_count?: number;
  completed_doc_count?: number;
  total_diagram_count?: number;
  total_doc_count?: number;
  [key: string]: unknown;
}

export type AgentStateUpdateEvent = Record<string, AgentStatePatch>;

export interface ProgressEventPayload {
  event?: string;
  type?: string;
  stage?: string;
  status?: string;
  message?: string;
  [key: string]: unknown;
}

export type SwarmRunRequest = {
  task_requirement: string;
  thread_id: string;
};

export type SwarmResumeRequest = {
  thread_id: string;
};

export type Artifact = {
  artifact_type: "diagram" | "doc" | string;
  name: string;
  component_slug: string;
  storage_key: string;
  url: string;
  iteration: number | null;
};

export type DiagramResult = {
  diagram_type: string;
  component_slug: string;
  storage_key: string;
  url: string;
  iteration: number;
};

export type DocResult = {
  title: string;
  component_slug: string;
  storage_key: string;
  url: string;
};

export type DebateLog = {
  agent: string;
  feedback: string;
  status: string;
  iteration: number;
};

export type SwarmRunResponse = {
  task_requirement: string;
  architecture_draft: string;
  architecture_json: Record<string, unknown>;
  component_list: string[];
  current_architecture_mermaid: string;
  complexity_score: number;
  diagram_plan: string[];
  doc_plan: string[];
  deep_dive_notes: string;
  generated_diagrams: DiagramResult[];
  thread_id: string;
  generated_docs: DocResult[];
  docs_complete: boolean;
  iteration_count: number;
  next_agent: string;
  scalability_feedback: string;
  security_feedback: string;
  debate_logs: DebateLog[];
};

export type CheckpointDiagram = {
  diagram_type: string;
  component_slug: string;
  valid: boolean;
  storage_key: string;
  url: string;
  iteration: number;
};

export type CheckpointDoc = {
  title: string;
  component_slug: string;
  storage_key: string;
  url: string;
};

export type CheckpointDebateLog = {
  agent: string;
  status: string;
  iteration: number;
};

export type SwarmCheckpointResponse = {
  thread_id: string;
  next: string[];
  component_list: string[];
  complexity_score: number;
  diagram_plan: string[];
  generated_diagram_count: number;
  generated_diagrams: CheckpointDiagram[];
  generated_doc_count: number;
  generated_docs: CheckpointDoc[];
  docs_complete: boolean;
  iteration_count: number;
  next_agent: string;
  scalability_feedback: string;
  security_feedback: string;
  debate_log_count: number;
  debate_logs: CheckpointDebateLog[];
};

export type SwarmSessionResponse = {
  thread_id: string;
  requirement: string;
  status: string;
  complexity: number | null;
  diagram_count: number | null;
  doc_count: number | null;
  architecture_draft: string;
  architecture_json: Record<string, unknown>;
  component_list: string[];
  current_architecture_mermaid: string;
  diagram_plan: string[];
  doc_plan: string[];
  deep_dive_notes: string;
  docs_complete: boolean;
  iteration_count: number;
  next_agent: string;
  scalability_feedback: string;
  security_feedback: string;
  debate_logs: DebateLog[];
  created_at: string | null;
  completed_at: string | null;
  generated_diagrams: Artifact[];
  generated_docs: Artifact[];
};

export type SwarmGraphInfo = {
  graph_id: string;
  name: string;
  description: string;
  supports_xray: boolean;
};

export type SwarmGraphListResponse = {
  graphs: SwarmGraphInfo[];
};

export type SwarmGraphMermaidResponse = {
  graph_id: string;
  mermaid: string;
  xray: boolean;
};

export type SwarmProgressPhase =
  | "supervisor"
  | "architecture"
  | "diagram"
  | "documentation"
  | "review"
  | "unknown";

export type SwarmProgressType =
  | "task_started"
  | "task_completed"
  | "state_update";

export type SwarmProgressEvent = {
  thread_id: string;
  type: SwarmProgressType;
  node: string;
  phase: SwarmProgressPhase;
  message: string;
  iteration_count: number | null;
  payload: Record<string, unknown>;
};

export type SwarmDoneEvent = {
  thread_id: string;
  status: "done";
};

export type SwarmErrorEvent = {
  thread_id: string;
  status: "failed";
  message: string;
};

export type SwarmStreamHandlers = {
  onProgress?: (event: SwarmProgressEvent) => void;
  onDone?: (event: SwarmDoneEvent) => void;
  onError?: (event: SwarmErrorEvent) => void;
};

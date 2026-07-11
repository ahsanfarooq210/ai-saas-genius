import type {
  Artifact,
  ArchitectureComponent,
  DebateLog,
  SwarmRevisionDetail,
  SwarmSessionResponse,
} from "@/api/swarm/swarm.types";

export type ArchitectureWorkspaceModel = {
  threadId: string;
  requirement: string;
  revisionNumber: number;
  latestInstruction: string;
  status: string;
  complexity: number | null;
  architectureDraft: string;
  architectureJson: Record<string, ArchitectureComponent>;
  componentList: string[];
  mermaid: string;
  diagramPlan: string[];
  docPlan: string[];
  deepDiveNotes: string;
  docsComplete: boolean;
  iterationCount: number;
  nextAgent: string;
  scalabilityFeedback: string;
  securityFeedback: string;
  debateLogs: DebateLog[];
  createdAt: string | null;
  completedAt: string | null;
  diagrams: Artifact[];
  documents: Artifact[];
};

const objectValue = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const stringValue = (value: unknown): string =>
  typeof value === "string" ? value : "";
const numberValue = (value: unknown): number =>
  typeof value === "number" ? value : 0;
const stringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

export function normalizeCurrentSession(
  session: SwarmSessionResponse,
): ArchitectureWorkspaceModel {
  return {
    threadId: session.thread_id,
    requirement: session.requirement,
    revisionNumber: session.revision_number,
    latestInstruction: session.latest_instruction,
    status: session.status,
    complexity: session.complexity,
    architectureDraft: session.architecture_draft,
    architectureJson: session.architecture_json,
    componentList: session.component_list,
    mermaid: session.current_architecture_mermaid,
    diagramPlan: session.diagram_plan,
    docPlan: session.doc_plan,
    deepDiveNotes: session.deep_dive_notes,
    docsComplete: session.docs_complete,
    iterationCount: session.iteration_count,
    nextAgent: session.next_agent,
    scalabilityFeedback: session.scalability_feedback,
    securityFeedback: session.security_feedback,
    debateLogs: session.debate_logs,
    createdAt: session.created_at,
    completedAt: session.completed_at,
    diagrams: session.generated_diagrams.filter(
      (item) => item.artifact_type === "diagram",
    ),
    documents: session.generated_docs.filter(
      (item) => item.artifact_type === "doc",
    ),
  };
}

export function normalizeHistoricalRevision(
  detail: SwarmRevisionDetail,
): ArchitectureWorkspaceModel | null {
  if (detail.status !== "done" || !Object.keys(detail.result).length)
    return null;
  const result = detail.result;
  const diagramValues = Array.isArray(result.generated_diagrams)
    ? result.generated_diagrams
    : [];
  const docValues = Array.isArray(result.generated_docs)
    ? result.generated_docs
    : [];
  const architecture = objectValue(result.architecture_json) as Record<
    string,
    ArchitectureComponent
  >;
  const debateLogs = Array.isArray(result.debate_logs)
    ? (result.debate_logs as DebateLog[])
    : [];
  return {
    threadId: detail.thread_id,
    requirement: stringValue(result.task_requirement),
    revisionNumber: detail.revision_number,
    latestInstruction:
      stringValue(result.revision_instruction) || detail.instruction,
    status: detail.status,
    complexity:
      typeof result.complexity_score === "number"
        ? result.complexity_score
        : null,
    architectureDraft: stringValue(result.architecture_draft),
    architectureJson: architecture,
    componentList: stringArray(result.component_list),
    mermaid: stringValue(result.current_architecture_mermaid),
    diagramPlan: stringArray(result.diagram_plan),
    docPlan: stringArray(result.doc_plan),
    deepDiveNotes: stringValue(result.deep_dive_notes),
    docsComplete: result.docs_complete === true,
    iterationCount: numberValue(result.iteration_count),
    nextAgent: stringValue(result.next_agent),
    scalabilityFeedback: stringValue(result.scalability_feedback),
    securityFeedback: stringValue(result.security_feedback),
    debateLogs,
    createdAt: detail.created_at,
    completedAt: detail.completed_at,
    diagrams: diagramValues.map((raw) => {
      const item = objectValue(raw);
      return {
        artifact_type: "diagram",
        name: stringValue(item.diagram_type),
        component_slug: stringValue(item.component_slug),
        storage_key: stringValue(item.storage_key),
        url: stringValue(item.url),
        iteration: typeof item.iteration === "number" ? item.iteration : null,
      };
    }),
    documents: docValues.map((raw) => {
      const item = objectValue(raw);
      return {
        artifact_type: "doc",
        name: stringValue(item.title),
        component_slug: stringValue(item.component_slug),
        storage_key: stringValue(item.storage_key),
        url: stringValue(item.url),
        iteration: null,
      };
    }),
  };
}

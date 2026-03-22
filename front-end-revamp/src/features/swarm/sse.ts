import { useSwarmStore } from "@/features/swarm/store";
import type {
  ArchitectEventPayload,
  DiagramGeneratorEventPayload,
  DocGeneratorEventPayload,
  DocPlannerEventPayload,
  DoneEventPayload,
  ReviewEventPayload,
  SupervisorEventPayload,
  SwarmEventPayload,
} from "@/features/swarm/types";

const SSE_TIMEOUT_MS = 3 * 60 * 1000;
const RECONNECT_DELAY_MS = 2000;
const EVENT_NAMES = [
  "supervisor",
  "architect",
  "doc_planner",
  "doc_generator",
  "diagram_generator",
  "scalability",
  "security",
  "done",
] as const;

const parseEventData = <T extends SwarmEventPayload>(raw: string): T | null => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const complexityLabel = (score: number | null) => {
  if (score === null) {
    return null;
  }
  if (score <= 3) {
    return "Simple system";
  }
  if (score <= 6) {
    return "Moderate";
  }
  return "Complex distributed system";
};

const handleSupervisorEvent = (payload: SupervisorEventPayload) => {
  const store = useSwarmStore.getState();
  const iteration = payload.iteration ?? store.iterationCount;

  useSwarmStore.setState({
    iterationCount: iteration,
    complexityScore: payload.complexity_score ?? store.complexityScore,
    docPlan: payload.doc_plan ?? store.docPlan,
  });

  if (payload.next === "architect") {
    store.setStage("running:architect", "Drafting architecture...");
    return;
  }
  if (payload.next === "doc_generator") {
    store.setStage("running:doc_generator", "Generating documentation...");
    return;
  }
  if (payload.next === "scalability") {
    store.setStage("running:scalability", "Reviewing architecture — Scalability...");
    return;
  }
  if (payload.next === "security") {
    store.setStage("running:security", "Reviewing architecture — Security...");
    return;
  }
  if (payload.next === "end") {
    if (payload.message) {
      useSwarmStore.setState({
        phaseLabel: payload.message,
      });
    }
    return;
  }

  if (payload.message) {
    store.setStage(store.stage, payload.message);
  }
};

const handleArchitectEvent = (payload: ArchitectEventPayload) => {
  const store = useSwarmStore.getState();

  if (payload.status === "started") {
    store.setArchitectStarted(payload.message ?? "Drafting architecture...");
    return;
  }

  if (payload.status === "architecture_ready") {
    const score = payload.complexity_score ?? null;
    const label = complexityLabel(score);
    const summaryMessage = payload.message ?? (label ? `${label} identified` : "Architecture drafted");

    store.setArchitectureReady({
      message: summaryMessage,
      complexityScore: payload.complexity_score,
      componentList: payload.component_list ?? [],
      diagramPlan: payload.diagram_plan ?? [],
      docPlan: payload.doc_plan ?? [],
      totalDiagrams: payload.diagram_count_planned,
    });

    (payload.diagram_plan ?? []).forEach((diagramType) => {
      store.updateDiagramItem({ type: diagramType, status: "pending" });
    });
  }
};

const handleDocPlannerEvent = (payload: DocPlannerEventPayload) => {
  const store = useSwarmStore.getState();

  if (payload.status === "planning") {
    useSwarmStore.setState({
      phaseLabel: payload.message ?? "Deciding which documents to generate...",
      complexityScore: payload.complexity_score ?? store.complexityScore,
    });
    return;
  }

  if (payload.status === "plan_ready") {
    store.setDocPlan({
      message: payload.message ?? "Documentation plan ready",
      docPlan: payload.doc_plan ?? [],
      totalDocs: payload.doc_count,
    });
  }
};

const handleDocGeneratorEvent = (payload: DocGeneratorEventPayload) => {
  const store = useSwarmStore.getState();
  store.setStage("running:doc_generator", "Generating documentation...");

  if (payload.status === "generating") {
    store.updateDocItem({
      slug: payload.doc_slug,
      status: "generating",
    });
    return;
  }

  if (payload.status === "doc_complete") {
    store.updateDocItem({
      slug: payload.doc_slug,
      status: "done",
      title: payload.title,
      path: payload.path,
      completedDocs: payload.completed_docs,
      totalDocs: payload.total_docs,
    });
  }
};

const handleDiagramGeneratorEvent = (payload: DiagramGeneratorEventPayload) => {
  const store = useSwarmStore.getState();
  store.setStage("running:doc_generator", "Generating documentation...");

  if (payload.status === "generating") {
    store.updateDiagramItem({
      type: payload.diagram_type,
      status: "generating",
    });
    return;
  }

  if (payload.status === "diagram_complete") {
    store.updateDiagramItem({
      type: payload.diagram_type,
      status: "done",
      path: payload.path,
      completedDiagrams: payload.completed_diagrams,
      totalDiagrams: payload.total_diagrams,
    });
    return;
  }

  if (payload.status === "diagram_failed") {
    store.updateDiagramItem({
      type: payload.diagram_type,
      status: "failed",
    });
  }
};

const handleReviewEvent = (agent: "scalability" | "security", payload: ReviewEventPayload) => {
  const store = useSwarmStore.getState();
  const stage = agent === "scalability" ? "running:scalability" : "running:security";

  if (payload.status === "reviewing") {
    store.setStage(
      stage,
      `Reviewing architecture — ${agent === "scalability" ? "Scalability" : "Security"}...`,
    );
    store.setReviewerState(agent, {
      reviewing: true,
      message: payload.message,
    });
    return;
  }

  if (payload.status === "review_complete") {
    store.setReviewerState(agent, {
      reviewing: false,
      message: payload.message,
      verdict: payload.verdict,
      iteration: payload.iteration,
    });

    if (payload.verdict === "REJECTED") {
      useSwarmStore.setState({
        phaseLabel: "Revising architecture...",
      });
    }
  }
};

const handleDoneEvent = (payload: DoneEventPayload, close: () => void) => {
  const store = useSwarmStore.getState();
  store.finalizeRun({
    complexityScore: payload.complexity_score,
    iterationCount: payload.iteration_count,
    diagramCount: payload.diagram_count,
    docCount: payload.doc_count,
    diagrams: payload.diagrams,
    docs: payload.docs,
    scalabilityVerdict: payload.scalability_verdict,
    securityVerdict: payload.security_verdict,
  });
  close();
};

export class SwarmSseClient {
  private readonly threadId: string;
  private eventSource: EventSource | null = null;
  private reconnectTimer: number | null = null;
  private timeoutTimer: number | null = null;
  private reconnectAttempted = false;
  private doneReceived = false;

  constructor(threadId: string) {
    this.threadId = threadId;
  }

  connect() {
    const backendBase = useSwarmStore.getState().settings.backendUrl;
    this.clearReconnectTimer();
    this.clearTimeoutTimer();

    this.eventSource = new EventSource(`${backendBase}/api/swarm/stream/${this.threadId}`);
    this.timeoutTimer = window.setTimeout(() => {
      if (this.doneReceived) {
        return;
      }
      this.disconnect();
      useSwarmStore.getState().setTimeoutMessage(
        "This is taking longer than expected. The run may still be processing in the background.",
      );
    }, SSE_TIMEOUT_MS);

    this.eventSource.onopen = () => {
      useSwarmStore.getState().setConnection(true);
      useSwarmStore.getState().setTimeoutMessage(null);
      useSwarmStore.getState().setErrorMessage(null);
    };

    EVENT_NAMES.forEach((eventName) => {
      this.eventSource?.addEventListener(eventName, (event) => {
        const payload = parseEventData(event.data);
        if (!payload) {
          return;
        }
        this.handleNamedEvent(eventName, payload);
      });
    });

    this.eventSource.onerror = () => {
      if (this.doneReceived) {
        return;
      }
      this.eventSource?.close();
      this.eventSource = null;

      if (this.reconnectAttempted) {
        useSwarmStore.getState().setReconnecting(false, 2, true);
        return;
      }

      this.reconnectAttempted = true;
      useSwarmStore.getState().setReconnecting(true, 1, false);
      this.reconnectTimer = window.setTimeout(() => {
        this.connect();
      }, RECONNECT_DELAY_MS);
    };
  }

  private handleNamedEvent(eventName: (typeof EVENT_NAMES)[number], payload: SwarmEventPayload) {
    switch (eventName) {
      case "supervisor":
        handleSupervisorEvent(payload as SupervisorEventPayload);
        break;
      case "architect":
        handleArchitectEvent(payload as ArchitectEventPayload);
        break;
      case "doc_planner":
        handleDocPlannerEvent(payload as DocPlannerEventPayload);
        break;
      case "doc_generator":
        handleDocGeneratorEvent(payload as DocGeneratorEventPayload);
        break;
      case "diagram_generator":
        handleDiagramGeneratorEvent(payload as DiagramGeneratorEventPayload);
        break;
      case "scalability":
        handleReviewEvent("scalability", payload as ReviewEventPayload);
        break;
      case "security":
        handleReviewEvent("security", payload as ReviewEventPayload);
        break;
      case "done":
        this.doneReceived = true;
        handleDoneEvent(payload as DoneEventPayload, () => this.disconnect());
        break;
    }
  }

  disconnect() {
    this.clearReconnectTimer();
    this.clearTimeoutTimer();
    this.eventSource?.close();
    this.eventSource = null;
    useSwarmStore.setState((state) => ({
      connection: {
        ...state.connection,
        connected: false,
        reconnecting: false,
      },
    }));
  }

  reconnectNow() {
    this.reconnectAttempted = false;
    this.doneReceived = false;
    this.connect();
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearTimeoutTimer() {
    if (this.timeoutTimer !== null) {
      window.clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }
}

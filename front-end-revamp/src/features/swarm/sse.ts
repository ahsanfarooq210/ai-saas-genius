import { useSwarmStore } from "@/features/swarm/store";
import type { SwarmSsePayload } from "@/features/swarm/types";

const nodeTaskMap: Record<string, string> = {
  draft_node: "Drafting architecture...",
  complexity_analyzer_node: "Analyzing complexity...",
  diagram_planner_node: "Planning diagram set...",
  linter_node: "Validating syntax...",
  doc_planner_node: "Planning document set...",
  doc_generator_node: "Generating documents...",
};

const parseEventData = (raw: string): SwarmSsePayload | null => {
  try {
    return JSON.parse(raw) as SwarmSsePayload;
  } catch {
    return null;
  }
};

export class SwarmSseClient {
  private threadId: string;
  private eventSource: EventSource | null = null;
  private attempts = 0;
  private readonly maxAttempts = 10;
  private reconnectTimer: number | null = null;

  constructor(threadId: string) {
    this.threadId = threadId;
  }

  connect() {
    const backendBase = useSwarmStore.getState().settings.backendUrl;
    this.eventSource = new EventSource(`${backendBase}/api/swarm/stream/${this.threadId}`);

    this.eventSource.onopen = () => {
      this.attempts = 0;
      useSwarmStore.getState().setConnection(true);
    };

    this.eventSource.onmessage = (event) => {
      const payload = parseEventData(event.data);
      if (!payload) {
        return;
      }
      handleSwarmEvent(payload);
    };

    this.eventSource.onerror = () => {
      this.eventSource?.close();
      this.eventSource = null;
      this.retry();
    };
  }

  disconnect() {
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.eventSource?.close();
    this.eventSource = null;
    useSwarmStore.getState().setConnection(false);
  }

  retry() {
    this.attempts += 1;
    const failed = this.attempts >= this.maxAttempts;
    useSwarmStore.getState().setReconnecting(!failed, this.attempts, failed);

    if (failed) {
      useSwarmStore.getState().setSessionStatus("failed");
      return;
    }

    this.reconnectTimer = window.setTimeout(() => {
      this.connect();
    }, 3000);
  }

  reconnectNow() {
    this.attempts = 0;
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connect();
  }
}

export const handleSwarmEvent = (payload: SwarmSsePayload) => {
  const { node, state_diff: stateDiff } = payload;
  const store = useSwarmStore.getState();

  if (node === "supervisor_node") {
    store.applyStateDiff(node, stateDiff);
    return;
  }

  if (["draft_node", "complexity_analyzer_node", "diagram_planner_node"].includes(node)) {
    store.setArchitectTask(nodeTaskMap[node] ?? "Working...");
  }

  if (node === "diagram_generator_node") {
    const diagramType = stateDiff.generated_diagrams?.at(-1)?.diagram_type ?? "next";
    store.setArchitectTask(`Generating diagram: ${diagramType}...`);
  }

  if (node === "linter_node") {
    store.setArchitectTask(nodeTaskMap.linter_node);
  }

  if (node === "doc_planner_node" || node === "doc_generator_node") {
    store.setArchitectTask(nodeTaskMap[node]);
  }

  if (node === "scalability_node") {
    store.setReviewerActive("scalability", "Scalability review in progress...");
  }

  if (node === "security_node") {
    store.setReviewerActive("security", "Security audit in progress...");
  }

  store.applyStateDiff(node, stateDiff);

  if (payload.type === "paused" || node === "__end__") {
    store.openHitlModal();
  }

  if (payload.type === "complete") {
    store.setSessionStatus("complete");
  }
};

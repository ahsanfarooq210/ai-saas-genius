import { swarmApi } from "@/features/swarm/api";
import { useSwarmStore } from "@/features/swarm/store";
import type { AgentStatePatch, ProgressEventPayload } from "@/features/swarm/types";

const SSE_TIMEOUT_MS = 3 * 60 * 1000;
const RECONNECT_DELAY_MS = 1500;

type StreamOwnerId = string;

interface OpenAgentStreamOptions {
  ownerId: StreamOwnerId;
  threadId: string;
  taskRequirement?: string;
  userId?: string | null;
}

interface ActiveStreamRecord {
  ownerId: StreamOwnerId;
  client: SwarmSseClient;
  releaseTimer: number | null;
  taskRequirement?: string;
}

const activeStreams = new Map<string, ActiveStreamRecord>();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseJsonRecord = <T extends Record<string, unknown>>(raw: string): T | null => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? (parsed as T) : null;
  } catch {
    return null;
  }
};

const parseSseEvent = (chunk: string) => {
  const event = {
    name: "message",
    data: "",
  };

  chunk.split("\n").forEach((line) => {
    const normalizedLine = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (!normalizedLine || normalizedLine.startsWith(":")) {
      return;
    }

    const separatorIndex = normalizedLine.indexOf(":");
    const field = separatorIndex >= 0 ? normalizedLine.slice(0, separatorIndex) : normalizedLine;
    const rawValue = separatorIndex >= 0 ? normalizedLine.slice(separatorIndex + 1).trimStart() : "";

    if (field === "event") {
      event.name = rawValue || "message";
      return;
    }

    if (field === "data") {
      event.data = event.data ? `${event.data}\n${rawValue}` : rawValue;
    }
  });

  return event;
};

class SwarmSseClient {
  private readonly threadId: string;
  private readonly userId?: string | null;
  private readonly onTerminalClose: () => void;
  private readonly taskRequirement?: string;
  private abortController: AbortController | null = null;
  private reconnectTimer: number | null = null;
  private timeoutTimer: number | null = null;
  private reconnectAttempts = 0;
  private closedManually = false;
  private terminalStateSeen = false;
  private opening = false;
  private resumeEligible = false;

  constructor(
    threadId: string,
    options: {
      taskRequirement?: string;
      userId?: string | null;
      onTerminalClose: () => void;
    },
  ) {
    this.threadId = threadId;
    this.taskRequirement = options.taskRequirement;
    this.userId = options.userId;
    this.onTerminalClose = options.onTerminalClose;
  }

  connect() {
    void this.openStream(this.taskRequirement);
  }

  disconnect() {
    this.closedManually = true;
    this.cleanup();
    useSwarmStore.getState().setConnection(false);
  }

  private async openStream(taskRequirement?: string) {
    if (this.opening) {
      return;
    }

    this.opening = true;
    this.clearReconnectTimer();
    this.resetTimeout();
    useSwarmStore.getState().clearTransientMessages();

    const controller = new AbortController();
    this.abortController = controller;

    try {
      const response = await fetch(
        swarmApi.buildStreamUrl(this.threadId, {
          taskRequirement,
          userId: this.userId,
        }),
        {
          ...swarmApi.getStreamRequestInit(),
          signal: controller.signal,
        },
      );

      if (response.status === 401 || response.status === 403) {
        useSwarmStore.getState().setAuthFailure(
          response.status === 401
            ? "Authentication failed for the swarm stream. Sign in again before retrying."
            : "You do not have access to this swarm thread.",
        );
        this.cleanup();
        this.onTerminalClose();
        return;
      }

      if (!response.ok || !response.body) {
        throw new Error(`Swarm stream request failed: ${response.status}`);
      }

      useSwarmStore.getState().setConnection(true);
      this.reconnectAttempts = 0;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        this.resetTimeout();
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

        let boundaryIndex = buffer.indexOf("\n\n");
        while (boundaryIndex >= 0) {
          const rawEvent = buffer.slice(0, boundaryIndex);
          buffer = buffer.slice(boundaryIndex + 2);
          this.handleSseChunk(rawEvent);
          boundaryIndex = buffer.indexOf("\n\n");
        }
      }

      if (buffer.trim()) {
        this.handleSseChunk(buffer);
      }

      if (!this.closedManually && !this.terminalStateSeen) {
        if (this.resumeEligible) {
          this.scheduleReconnect();
        } else {
          useSwarmStore
            .getState()
            .setStreamError("The initial swarm stream closed before a resumable checkpoint was established.");
          this.onTerminalClose();
        }
      }
    } catch (error) {
      if (!this.closedManually && !controller.signal.aborted) {
        if (this.resumeEligible) {
          this.scheduleReconnect(error instanceof Error ? error.message : "Swarm stream interrupted.");
        } else {
          useSwarmStore
            .getState()
            .setStreamError(
              error instanceof Error
                ? error.message
                : "The initial swarm stream failed before checkpoint resume was available.",
            );
          this.onTerminalClose();
        }
      }
    } finally {
      this.opening = false;
    }
  }

  private handleSseChunk(rawChunk: string) {
    const event = parseSseEvent(rawChunk);
    if (!event.data) {
      return;
    }

    if (event.name === "state_update") {
      const payload = parseJsonRecord<AgentStatePatch>(event.data);
      if (!payload) {
        return;
      }

      this.resumeEligible = true;
      useSwarmStore.getState().mergeStateUpdate(payload);

      const currentStage = typeof payload.current_stage === "string" ? payload.current_stage.toLowerCase() : null;
      if (currentStage && ["done", "complete", "completed", "finished"].includes(currentStage)) {
        this.terminalStateSeen = true;
        this.cleanup();
        useSwarmStore.getState().setConnection(false);
        this.onTerminalClose();
      }
      return;
    }

    if (event.name === "progress") {
      const payload = parseJsonRecord<ProgressEventPayload>(event.data);
      if (!payload) {
        return;
      }

      this.resumeEligible = true;
      useSwarmStore.getState().appendProgressEvent(this.threadId, payload);
      return;
    }

    if (event.name === "error") {
      const payload = parseJsonRecord<{ message?: string }>(event.data);
      useSwarmStore
        .getState()
        .setStreamError(payload?.message ?? "The swarm stream reported an application error.");
      this.cleanup();
      this.onTerminalClose();
    }
  }

  private scheduleReconnect(reason?: string) {
    const store = useSwarmStore.getState();
    const nextAttempt = this.reconnectAttempts + 1;
    const failed = nextAttempt > store.connection.maxAttempts;

    if (failed) {
      store.setReconnecting(false, this.reconnectAttempts, true);
      this.cleanup();
      this.onTerminalClose();
      return;
    }

    this.reconnectAttempts = nextAttempt;
    this.cleanup();
    store.setTimeoutMessage(reason ?? "Live updates paused. Reconnecting to resume from the last checkpoint.");
    store.setReconnecting(true, nextAttempt, false);

    const delay = RECONNECT_DELAY_MS * Math.min(2 ** (nextAttempt - 1), 4);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closedManually) {
        void this.openStream();
      }
    }, delay);
  }

  private resetTimeout() {
    this.clearTimeoutTimer();
    this.timeoutTimer = window.setTimeout(() => {
      useSwarmStore
        .getState()
        .setTimeoutMessage("No swarm updates arrived for several minutes. Waiting for the backend or a reconnect.");
    }, SSE_TIMEOUT_MS);
  }

  private cleanup() {
    this.clearReconnectTimer();
    this.clearTimeoutTimer();

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
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

const closeRecord = (threadId: string) => {
  const existing = activeStreams.get(threadId);
  if (!existing) {
    return;
  }

  if (existing.releaseTimer !== null) {
    window.clearTimeout(existing.releaseTimer);
  }

  existing.client.disconnect();
  activeStreams.delete(threadId);
};

export const openAgentStream = ({ ownerId, threadId, taskRequirement, userId }: OpenAgentStreamOptions) => {
  const existing = activeStreams.get(threadId);
  if (existing) {
    if (existing.releaseTimer !== null) {
      window.clearTimeout(existing.releaseTimer);
      existing.releaseTimer = null;
    }

    if (existing.ownerId === ownerId) {
      return existing.client;
    }

    closeRecord(threadId);
  }

  const client = new SwarmSseClient(threadId, {
    taskRequirement,
    userId,
    onTerminalClose: () => {
      const current = activeStreams.get(threadId);
      if (current?.client === client) {
        activeStreams.delete(threadId);
      }
    },
  });

  activeStreams.set(threadId, {
    ownerId,
    client,
    releaseTimer: null,
    taskRequirement,
  });

  client.connect();
  return client;
};

export const closeAgentStream = (threadId: string, ownerId?: StreamOwnerId) => {
  const existing = activeStreams.get(threadId);
  if (!existing) {
    return;
  }

  if (ownerId && existing.ownerId !== ownerId) {
    return;
  }

  if (existing.releaseTimer !== null) {
    window.clearTimeout(existing.releaseTimer);
  }

  existing.releaseTimer = window.setTimeout(() => {
    const current = activeStreams.get(threadId);
    if (!current || current.ownerId !== existing.ownerId) {
      return;
    }

    closeRecord(threadId);
  }, 0);
};

import { create } from "zustand";
import type {
  AgentCardState,
  DebateEntry,
  DiagramEntry,
  DocEntry,
  SessionHistoryItem,
  SessionStatus,
  SwarmStateDiff,
} from "@/features/swarm/types";

interface SettingsState {
  openAiApiKey: string;
  langSmithApiKey: string;
  backendUrl: string;
  soundEnabled: boolean;
  autoScrollDebate: boolean;
}

interface SwarmStoreState {
  threadId: string | null;
  requirement: string;
  sessionStatus: SessionStatus;
  iterationCount: number;
  maxIterations: number;
  complexityScore: number | null;
  architectureJson: Record<string, unknown> | null;
  generatedDiagrams: DiagramEntry[];
  generatedDocs: DocEntry[];
  debateLog: DebateEntry[];
  docPlan: string[];
  diagramPlan: string[];
  agentStates: {
    architect: AgentCardState;
    scalability: AgentCardState;
    security: AgentCardState;
  };
  connection: {
    connected: boolean;
    reconnecting: boolean;
    attempts: number;
    maxAttempts: number;
    permanentlyFailed: boolean;
  };
  hitlModalOpen: boolean;
  hitlCritiqueOpen: boolean;
  phaseLabel: string;
  settings: SettingsState;
  sessionHistory: SessionHistoryItem[];
  exportReady: boolean;
  startSession: (threadId: string, requirement: string) => void;
  resetForNewSession: () => void;
  setSessionStatus: (status: SessionStatus) => void;
  setConnection: (connected: boolean) => void;
  setReconnecting: (reconnecting: boolean, attempts: number, failed: boolean) => void;
  setArchitectTask: (task: string) => void;
  setReviewerActive: (agent: "scalability" | "security", task: string) => void;
  applyStateDiff: (node: string, diff: SwarmStateDiff) => void;
  openHitlModal: () => void;
  closeHitlModal: () => void;
  setHitlCritiqueOpen: (open: boolean) => void;
  completeSession: () => void;
  setExportReady: (ready: boolean) => void;
  updateSettings: (settings: Partial<SettingsState>) => void;
  hydrateSettings: () => void;
  saveSessionHistoryItem: () => void;
  hydrateSessionHistory: () => void;
  hydrateSessionFromHistory: (threadId: string) => void;
}

const SETTINGS_STORAGE_KEY = "swarm_settings";
const HISTORY_STORAGE_KEY = "swarm_history";

const defaultSettings: SettingsState = {
  openAiApiKey: "",
  langSmithApiKey: "",
  backendUrl: (import.meta.env.VITE_SERVER_URL as string | undefined) ?? "http://localhost:8000",
  soundEnabled: true,
  autoScrollDebate: true,
};

const baseAgentState = (model: string): AgentCardState => ({
  state: "idle",
  model,
  currentTask: "",
  lastIteration: 0,
});

const parseFeedback = (feedback: string): { status: "APPROVED" | "REJECTED"; markdown: string } => {
  const normalized = feedback.trim();
  const status = /status\s*:\s*approved|\bapproved\b/i.test(normalized)
    ? "APPROVED"
    : "REJECTED";
  return {
    status,
    markdown: normalized,
  };
};

const toDocPlan = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  return [];
};

export const useSwarmStore = create<SwarmStoreState>((set) => ({
  threadId: null,
  requirement: "",
  sessionStatus: "idle",
  iterationCount: 0,
  maxIterations: 5,
  complexityScore: null,
  architectureJson: null,
  generatedDiagrams: [],
  generatedDocs: [],
  debateLog: [],
  docPlan: [],
  diagramPlan: [],
  agentStates: {
    architect: baseAgentState("GPT-4o"),
    scalability: baseAgentState("GPT-4o"),
    security: baseAgentState("GPT-4o"),
  },
  connection: {
    connected: false,
    reconnecting: false,
    attempts: 0,
    maxAttempts: 10,
    permanentlyFailed: false,
  },
  hitlModalOpen: false,
  hitlCritiqueOpen: false,
  phaseLabel: "Awaiting session start",
  settings: defaultSettings,
  sessionHistory: [],
  exportReady: false,

  startSession: (threadId, requirement) =>
    set(() => ({
      threadId,
      requirement,
      sessionStatus: "running",
      phaseLabel: "Iteration 1 of 5 — Initializing swarm",
      hitlModalOpen: false,
      hitlCritiqueOpen: false,
      exportReady: false,
    })),

  resetForNewSession: () =>
    set(() => ({
      threadId: null,
      requirement: "",
      sessionStatus: "idle",
      iterationCount: 0,
      maxIterations: 5,
      complexityScore: null,
      architectureJson: null,
      generatedDiagrams: [],
      generatedDocs: [],
      debateLog: [],
      docPlan: [],
      diagramPlan: [],
      agentStates: {
        architect: baseAgentState("GPT-4o"),
        scalability: baseAgentState("GPT-4o"),
        security: baseAgentState("GPT-4o"),
      },
      connection: {
        connected: false,
        reconnecting: false,
        attempts: 0,
        maxAttempts: 10,
        permanentlyFailed: false,
      },
      hitlModalOpen: false,
      hitlCritiqueOpen: false,
      phaseLabel: "Awaiting session start",
      exportReady: false,
    })),

  setSessionStatus: (status) => set(() => ({ sessionStatus: status })),

  setConnection: (connected) =>
    set((state) => ({
      connection: {
        ...state.connection,
        connected,
        reconnecting: false,
        permanentlyFailed: false,
        attempts: connected ? 0 : state.connection.attempts,
      },
    })),

  setReconnecting: (reconnecting, attempts, failed) =>
    set((state) => ({
      connection: {
        ...state.connection,
        connected: false,
        reconnecting,
        attempts,
        permanentlyFailed: failed,
      },
    })),

  setArchitectTask: (task) =>
    set((state) => ({
      phaseLabel: `Iteration ${Math.max(state.iterationCount, 1)} of ${state.maxIterations} — ${task}`,
      agentStates: {
        architect: {
          ...state.agentStates.architect,
          state: "active",
          currentTask: task,
          lastIteration: Math.max(state.iterationCount, 1),
        },
        scalability:
          state.agentStates.scalability.state === "active"
            ? { ...state.agentStates.scalability, state: "idle", currentTask: "" }
            : state.agentStates.scalability,
        security:
          state.agentStates.security.state === "active"
            ? { ...state.agentStates.security, state: "idle", currentTask: "" }
            : state.agentStates.security,
      },
    })),

  setReviewerActive: (agent, task) =>
    set((state) => ({
      phaseLabel: `Iteration ${Math.max(state.iterationCount, 1)} of ${state.maxIterations} — ${task}`,
      agentStates: {
        architect:
          state.agentStates.architect.state === "active"
            ? { ...state.agentStates.architect, state: "idle", currentTask: "" }
            : state.agentStates.architect,
        scalability: {
          ...state.agentStates.scalability,
          state: agent === "scalability" ? "active" : state.agentStates.scalability.state,
          currentTask: agent === "scalability" ? task : state.agentStates.scalability.currentTask,
          lastIteration: agent === "scalability" ? Math.max(state.iterationCount, 1) : state.agentStates.scalability.lastIteration,
        },
        security: {
          ...state.agentStates.security,
          state: agent === "security" ? "active" : state.agentStates.security.state,
          currentTask: agent === "security" ? task : state.agentStates.security.currentTask,
          lastIteration: agent === "security" ? Math.max(state.iterationCount, 1) : state.agentStates.security.lastIteration,
        },
      },
    })),

  applyStateDiff: (node, diff) =>
    set((state) => {
      const nextDiagrams = [...state.generatedDiagrams];
      if (Array.isArray(diff.generated_diagrams)) {
        diff.generated_diagrams.forEach((diagram) => {
          const index = nextDiagrams.findIndex((item) => item.diagram_type === diagram.diagram_type);
          const normalized: DiagramEntry = {
            ...diagram,
            updated_at: new Date().toISOString(),
          };
          if (index >= 0) {
            nextDiagrams[index] = normalized;
          } else {
            nextDiagrams.push(normalized);
          }
        });
      }

      const nextDocs = [...state.generatedDocs];
      if (Array.isArray(diff.generated_docs)) {
        diff.generated_docs.forEach((doc) => {
          const index = nextDocs.findIndex((item) => item.title === doc.title);
          if (index >= 0) {
            nextDocs[index] = doc;
          } else {
            nextDocs.push(doc);
          }
        });
      }

      const nextDebateLog = [...state.debateLog];

      if (typeof diff.scalability_feedback === "string" && diff.scalability_feedback.trim()) {
        const parsed = parseFeedback(diff.scalability_feedback);
        nextDebateLog.push({
          id: crypto.randomUUID(),
          agent: "scalability",
          iteration: diff.iteration_count ?? state.iterationCount,
          markdown: parsed.markdown,
          status: parsed.status,
          created_at: new Date().toISOString(),
        });
      }

      if (typeof diff.security_feedback === "string" && diff.security_feedback.trim()) {
        const parsed = parseFeedback(diff.security_feedback);
        nextDebateLog.push({
          id: crypto.randomUUID(),
          agent: "security",
          iteration: diff.iteration_count ?? state.iterationCount,
          markdown: parsed.markdown,
          status: parsed.status,
          created_at: new Date().toISOString(),
        });
      }

      const scalabilityStatus =
        typeof diff.scalability_feedback === "string" && diff.scalability_feedback.trim()
          ? parseFeedback(diff.scalability_feedback).status
          : null;
      const securityStatus =
        typeof diff.security_feedback === "string" && diff.security_feedback.trim()
          ? parseFeedback(diff.security_feedback).status
          : null;

      const nextIteration = diff.iteration_count ?? state.iterationCount;
      const nextMaxIterations = diff.max_iterations ?? state.maxIterations;

      const nextState = {
        threadId: diff.thread_id ?? state.threadId,
        iterationCount: nextIteration,
        maxIterations: nextMaxIterations,
        complexityScore: diff.complexity_score ?? state.complexityScore,
        architectureJson: diff.architecture_json ?? state.architectureJson,
        generatedDiagrams: nextDiagrams,
        generatedDocs: nextDocs,
        debateLog: nextDebateLog,
        docPlan: diff.doc_plan ? toDocPlan(diff.doc_plan) : state.docPlan,
        diagramPlan: diff.diagram_plan ? toDocPlan(diff.diagram_plan) : state.diagramPlan,
        sessionStatus: diff.status ?? state.sessionStatus,
        agentStates: {
          architect: {
            ...state.agentStates.architect,
            state: node === "write_state_node" ? "idle" : state.agentStates.architect.state,
          },
          scalability: {
            ...state.agentStates.scalability,
            state:
              scalabilityStatus === "APPROVED"
                ? "approved"
                : scalabilityStatus === "REJECTED"
                  ? "rejected"
                  : state.agentStates.scalability.state,
            currentTask: scalabilityStatus ? "" : state.agentStates.scalability.currentTask,
            lastIteration: scalabilityStatus
              ? nextIteration
              : state.agentStates.scalability.lastIteration,
          },
          security: {
            ...state.agentStates.security,
            state:
              securityStatus === "APPROVED"
                ? "approved"
                : securityStatus === "REJECTED"
                  ? "rejected"
                  : state.agentStates.security.state,
            currentTask: securityStatus ? "" : state.agentStates.security.currentTask,
            lastIteration: securityStatus ? nextIteration : state.agentStates.security.lastIteration,
          },
        },
      };

      const approvalCount = [
        nextState.agentStates.scalability.state,
        nextState.agentStates.security.state,
      ].filter((value) => value === "approved").length;

      const phaseLabel =
        node === "supervisor_node"
          ? `Iteration ${Math.max(nextIteration, 1)} of ${nextMaxIterations} — Supervisor routing`
          : state.phaseLabel;

      return {
        ...nextState,
        phaseLabel:
          nextState.sessionStatus === "paused"
            ? `Iteration ${nextIteration} complete — awaiting human review`
            : nextState.sessionStatus === "complete"
              ? `Completed in ${nextIteration} iteration${nextIteration === 1 ? "" : "s"} — ${approvalCount}/2 reviewers approved`
              : phaseLabel,
      };
    }),

  openHitlModal: () => set(() => ({ hitlModalOpen: true, hitlCritiqueOpen: false, sessionStatus: "paused" })),

  closeHitlModal: () => set(() => ({ hitlModalOpen: false, hitlCritiqueOpen: false })),

  setHitlCritiqueOpen: (open) => set(() => ({ hitlCritiqueOpen: open })),

  completeSession: () =>
    set((state) => ({
      sessionStatus: "complete",
      hitlModalOpen: true,
      hitlCritiqueOpen: false,
      exportReady: true,
      phaseLabel: `Completed in ${state.iterationCount} iteration${state.iterationCount === 1 ? "" : "s"}`,
    })),

  setExportReady: (ready) => set(() => ({ exportReady: ready })),

  updateSettings: (settings) =>
    set((state) => {
      const merged = { ...state.settings, ...settings };
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(merged));
      return { settings: merged };
    }),

  hydrateSettings: () =>
    set(() => {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (!raw) {
        return { settings: defaultSettings };
      }
      try {
        const parsed = JSON.parse(raw) as SettingsState;
        return {
          settings: {
            ...defaultSettings,
            ...parsed,
          },
        };
      } catch {
        return { settings: defaultSettings };
      }
    }),

  saveSessionHistoryItem: () =>
    set((state) => {
      if (!state.threadId) {
        return state;
      }
      const nextEntry: SessionHistoryItem = {
        threadId: state.threadId,
        requirement: state.requirement,
        createdAt: new Date().toISOString(),
        complexityScore: state.complexityScore,
        status:
          state.sessionStatus === "running"
            ? "Running"
            : state.sessionStatus === "failed"
              ? "Failed"
              : "Complete",
        diagramsCount: state.generatedDiagrams.length,
        docsCount: state.generatedDocs.length,
        snapshot: {
          iterationCount: state.iterationCount,
          maxIterations: state.maxIterations,
          complexityScore: state.complexityScore,
          generatedDiagrams: state.generatedDiagrams,
          generatedDocs: state.generatedDocs,
          debateLog: state.debateLog,
          docPlan: state.docPlan,
          diagramPlan: state.diagramPlan,
          architectureJson: state.architectureJson,
        },
      };
      const deduped = [nextEntry, ...state.sessionHistory.filter((item) => item.threadId !== state.threadId)];
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(deduped));
      return { sessionHistory: deduped };
    }),

  hydrateSessionHistory: () =>
    set(() => {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (!raw) {
        return { sessionHistory: [] };
      }
      try {
        const parsed = JSON.parse(raw) as SessionHistoryItem[];
        return {
          sessionHistory: parsed,
        };
      } catch {
        return { sessionHistory: [] };
      }
    }),

  hydrateSessionFromHistory: (threadId) =>
    set((state) => {
      const historyMatch = state.sessionHistory.find((item) => item.threadId === threadId);
      if (!historyMatch?.snapshot) {
        return state;
      }

      const snapshot = historyMatch.snapshot;
      return {
        threadId: historyMatch.threadId,
        requirement: historyMatch.requirement,
        iterationCount: snapshot.iterationCount,
        maxIterations: snapshot.maxIterations,
        complexityScore: snapshot.complexityScore,
        architectureJson: snapshot.architectureJson,
        generatedDiagrams: snapshot.generatedDiagrams,
        generatedDocs: snapshot.generatedDocs,
        debateLog: snapshot.debateLog,
        docPlan: snapshot.docPlan,
        diagramPlan: snapshot.diagramPlan,
        sessionStatus: historyMatch.status === "Complete" ? "complete" : historyMatch.status === "Failed" ? "failed" : "running",
        hitlModalOpen: false,
        hitlCritiqueOpen: false,
      };
    }),
}));

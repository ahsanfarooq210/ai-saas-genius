import { create } from "zustand";
import type {
  AgentCardState,
  DiagramEntry,
  DocEntry,
  SessionHistoryItem,
  SessionStatus,
  SwarmRunResponse,
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
  userId: string | null;
  requirement: string;
  sessionStatus: SessionStatus;
  iterationCount: number;
  docsComplete: boolean;
  nextAgent: string;
  currentArchitectureMermaid: string;
  complexityScore: number | null;
  architectureJson: Record<string, unknown>;
  componentList: string[];
  generatedDiagrams: DiagramEntry[];
  generatedDocs: DocEntry[];
  docPlan: string[];
  diagramPlan: string[];
  scalabilityFeedback: string;
  securityFeedback: string;
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
  startSession: (requirement: string) => void;
  setRunResult: (result: SwarmRunResponse) => void;
  resetForNewSession: () => void;
  setSessionStatus: (status: SessionStatus) => void;
  setConnection: (connected: boolean) => void;
  setReconnecting: (reconnecting: boolean, attempts: number, failed: boolean) => void;
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

const toDocPlan = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  return [];
};

const isApprovedFeedback = (feedback: string): boolean =>
  /status\s*:\s*approved|approved\b/i.test(feedback.trim());

export const useSwarmStore = create<SwarmStoreState>((set) => ({
  threadId: null,
  userId: null,
  requirement: "",
  sessionStatus: "idle",
  iterationCount: 0,
  docsComplete: false,
  nextAgent: "",
  currentArchitectureMermaid: "",
  complexityScore: null,
  architectureJson: {},
  componentList: [],
  generatedDiagrams: [],
  generatedDocs: [],
  docPlan: [],
  diagramPlan: [],
  scalabilityFeedback: "",
  securityFeedback: "",
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

  startSession: (requirement) =>
    set(() => ({
      requirement,
      sessionStatus: "running",
      phaseLabel: "Running architecture swarm (this can take a few minutes)...",
      connection: {
        connected: true,
        reconnecting: false,
        attempts: 0,
        maxAttempts: 10,
        permanentlyFailed: false,
      },
      hitlModalOpen: false,
      hitlCritiqueOpen: false,
      exportReady: false,
    })),

  setRunResult: (result) =>
    set((state) => {
      const scalabilityApproved = isApprovedFeedback(result.scalability_feedback);
      const securityApproved = isApprovedFeedback(result.security_feedback);

      return {
        ...state,
        threadId: result.thread_id,
        userId: result.user_id,
        requirement: result.task_requirement,
        sessionStatus: "complete",
        iterationCount: result.iteration_count,
        docsComplete: result.docs_complete,
        nextAgent: result.next_agent,
        currentArchitectureMermaid: result.current_architecture_mermaid,
        complexityScore: result.complexity_score,
        architectureJson: result.architecture_json ?? {},
        componentList: result.component_list ?? [],
        generatedDiagrams: result.generated_diagrams ?? [],
        generatedDocs: result.generated_docs ?? [],
        docPlan: toDocPlan(result.doc_plan),
        diagramPlan: toDocPlan(result.diagram_plan),
        scalabilityFeedback: result.scalability_feedback ?? "",
        securityFeedback: result.security_feedback ?? "",
        exportReady: true,
        phaseLabel: `Completed in ${result.iteration_count} iteration${result.iteration_count === 1 ? "" : "s"}`,
        connection: {
          connected: true,
          reconnecting: false,
          attempts: 0,
          maxAttempts: 10,
          permanentlyFailed: false,
        },
        agentStates: {
          architect: {
            ...state.agentStates.architect,
            state: "idle",
            currentTask: "",
            lastIteration: result.iteration_count,
          },
          scalability: {
            ...state.agentStates.scalability,
            state: scalabilityApproved ? "approved" : "rejected",
            currentTask: "",
            lastIteration: result.iteration_count,
          },
          security: {
            ...state.agentStates.security,
            state: securityApproved ? "approved" : "rejected",
            currentTask: "",
            lastIteration: result.iteration_count,
          },
        },
      };
    }),

  resetForNewSession: () =>
    set(() => ({
      threadId: null,
      userId: null,
      requirement: "",
      sessionStatus: "idle",
      iterationCount: 0,
      docsComplete: false,
      nextAgent: "",
      currentArchitectureMermaid: "",
      complexityScore: null,
      architectureJson: {},
      componentList: [],
      generatedDiagrams: [],
      generatedDocs: [],
      docPlan: [],
      diagramPlan: [],
      scalabilityFeedback: "",
      securityFeedback: "",
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
          threadId: state.threadId,
          userId: state.userId,
          requirement: state.requirement,
          iterationCount: state.iterationCount,
          docsComplete: state.docsComplete,
          nextAgent: state.nextAgent,
          currentArchitectureMermaid: state.currentArchitectureMermaid,
          complexityScore: state.complexityScore,
          componentList: state.componentList,
          generatedDiagrams: state.generatedDiagrams,
          generatedDocs: state.generatedDocs,
          docPlan: state.docPlan,
          diagramPlan: state.diagramPlan,
          architectureJson: state.architectureJson ?? {},
          scalabilityFeedback: state.scalabilityFeedback,
          securityFeedback: state.securityFeedback,
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
        userId: snapshot.userId,
        requirement: historyMatch.requirement,
        iterationCount: snapshot.iterationCount,
        docsComplete: snapshot.docsComplete,
        nextAgent: snapshot.nextAgent,
        currentArchitectureMermaid: snapshot.currentArchitectureMermaid,
        complexityScore: snapshot.complexityScore,
        architectureJson: snapshot.architectureJson ?? {},
        componentList: snapshot.componentList ?? [],
        generatedDiagrams: snapshot.generatedDiagrams,
        generatedDocs: snapshot.generatedDocs,
        docPlan: snapshot.docPlan,
        diagramPlan: snapshot.diagramPlan,
        scalabilityFeedback: snapshot.scalabilityFeedback ?? "",
        securityFeedback: snapshot.securityFeedback ?? "",
        sessionStatus: historyMatch.status === "Complete" ? "complete" : historyMatch.status === "Failed" ? "failed" : "running",
        hitlModalOpen: false,
        hitlCritiqueOpen: false,
      };
    }),
}));

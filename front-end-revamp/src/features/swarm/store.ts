import { create } from "zustand";
import type {
  AgentCardState,
  DiagramEntry,
  DocEntry,
  ReviewVerdict,
  SessionHistoryItem,
  SessionStatus,
  SessionSnapshot,
  SwarmStage,
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
  stage: SwarmStage;
  iterationCount: number;
  maxIterations: number;
  phaseLabel: string;
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
  errorMessage: string | null;
  architectureJson: Record<string, unknown> | null;
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
  settings: SettingsState;
  sessionHistory: SessionHistoryItem[];
  startSession: (threadId: string, requirement: string) => void;
  resetForNewSession: () => void;
  setSessionStatus: (status: SessionStatus) => void;
  setConnection: (connected: boolean) => void;
  setReconnecting: (reconnecting: boolean, attempts: number, failed: boolean) => void;
  setStage: (stage: SwarmStage, label?: string) => void;
  setTimeoutMessage: (message: string | null) => void;
  setErrorMessage: (message: string | null) => void;
  setArchitectStarted: (message?: string) => void;
  setArchitectureReady: (payload: {
    message?: string;
    complexityScore?: number;
    componentList?: string[];
    diagramPlan?: string[];
    docPlan?: string[];
    totalDiagrams?: number;
  }) => void;
  setDocPlan: (payload: { message?: string; docPlan?: string[]; totalDocs?: number }) => void;
  updateDocItem: (payload: {
    slug?: string;
    status: "pending" | "generating" | "done";
    title?: string;
    path?: string;
    completedDocs?: number;
    totalDocs?: number;
  }) => void;
  updateDiagramItem: (payload: {
    type?: string;
    status: "pending" | "generating" | "done" | "failed";
    path?: string;
    completedDiagrams?: number;
    totalDiagrams?: number;
  }) => void;
  setReviewerState: (agent: "scalability" | "security", payload: {
    reviewing?: boolean;
    message?: string;
    verdict?: ReviewVerdict;
    iteration?: number;
  }) => void;
  finalizeRun: (payload: {
    complexityScore?: number;
    iterationCount?: number;
    diagramCount?: number;
    docCount?: number;
    diagrams?: Array<{ type: string; path: string }>;
    docs?: Array<{ title: string; path: string }>;
    scalabilityVerdict?: ReviewVerdict;
    securityVerdict?: ReviewVerdict;
  }) => void;
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

const baseAgentState = (): AgentCardState => ({
  state: "idle",
  model: "LangGraph Agent",
  currentTask: "",
  lastIteration: 0,
});

const initialState = () => ({
  threadId: null as string | null,
  requirement: "",
  sessionStatus: "idle" as SessionStatus,
  stage: "idle" as SwarmStage,
  iterationCount: 0,
  maxIterations: 5,
  phaseLabel: "Awaiting session start",
  complexityScore: null as number | null,
  componentList: [] as string[],
  diagramPlan: [] as string[],
  docPlan: [] as string[],
  totalDiagrams: 0,
  completedDiagrams: 0,
  totalDocs: 0,
  completedDocs: 0,
  generatedDiagrams: [] as DiagramEntry[],
  generatedDocs: [] as DocEntry[],
  scalabilityVerdict: null as ReviewVerdict | null,
  securityVerdict: null as ReviewVerdict | null,
  timeoutMessage: null as string | null,
  errorMessage: null as string | null,
  architectureJson: null as Record<string, unknown> | null,
  agentStates: {
    architect: baseAgentState(),
    scalability: baseAgentState(),
    security: baseAgentState(),
  },
  connection: {
    connected: false,
    reconnecting: false,
    attempts: 0,
    maxAttempts: 2,
    permanentlyFailed: false,
  },
});

const toHistoryStatus = (status: SessionStatus): SessionHistoryItem["status"] => {
  if (status === "complete") {
    return "Complete";
  }
  if (status === "failed") {
    return "Failed";
  }
  return "Running";
};

const snapshotFromState = (state: SwarmStoreState): SessionSnapshot => ({
  stage: state.stage,
  phaseLabel: state.phaseLabel,
  iterationCount: state.iterationCount,
  maxIterations: state.maxIterations,
  complexityScore: state.complexityScore,
  componentList: state.componentList,
  diagramPlan: state.diagramPlan,
  docPlan: state.docPlan,
  totalDiagrams: state.totalDiagrams,
  completedDiagrams: state.completedDiagrams,
  totalDocs: state.totalDocs,
  completedDocs: state.completedDocs,
  generatedDiagrams: state.generatedDiagrams,
  generatedDocs: state.generatedDocs,
  scalabilityVerdict: state.scalabilityVerdict,
  securityVerdict: state.securityVerdict,
  timeoutMessage: state.timeoutMessage,
});

export const useSwarmStore = create<SwarmStoreState>((set) => ({
  ...initialState(),
  settings: defaultSettings,
  sessionHistory: [],

  startSession: (threadId, requirement) =>
    set((state) => ({
      ...state,
      ...initialState(),
      threadId,
      requirement,
      sessionStatus: "starting",
      stage: "starting",
      phaseLabel: "Starting swarm run...",
      settings: state.settings,
      sessionHistory: state.sessionHistory,
    })),

  resetForNewSession: () =>
    set((state) => ({
      ...state,
      ...initialState(),
      settings: state.settings,
      sessionHistory: state.sessionHistory,
    })),

  setSessionStatus: (status) => set(() => ({ sessionStatus: status })),

  setConnection: (connected) =>
    set((state) => ({
      connection: {
        ...state.connection,
        connected,
        reconnecting: false,
        attempts: connected ? 0 : state.connection.attempts,
        permanentlyFailed: false,
      },
      sessionStatus:
        connected && (state.sessionStatus === "idle" || state.sessionStatus === "starting")
          ? "running"
          : state.sessionStatus,
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
      errorMessage: failed
        ? "Live updates stopped after one reconnect attempt. The run may still be processing in the background."
        : state.errorMessage,
      sessionStatus: failed ? "failed" : state.sessionStatus,
      stage: failed ? "error" : state.stage,
    })),

  setStage: (stage, label) =>
    set(() => ({
      stage,
      phaseLabel: label ?? "Working...",
      sessionStatus:
        stage === "complete" ? "complete" : stage === "error" ? "failed" : stage === "starting" ? "starting" : "running",
    })),

  setTimeoutMessage: (message) => set(() => ({ timeoutMessage: message })),

  setErrorMessage: (message) => set(() => ({ errorMessage: message })),

  setArchitectStarted: (message) =>
    set((state) => ({
      stage: "running:architect",
      sessionStatus: "running",
      phaseLabel: message ?? "Drafting architecture...",
      agentStates: {
        ...state.agentStates,
        architect: {
          ...state.agentStates.architect,
          state: "active",
          currentTask: message ?? "Drafting architecture...",
          lastIteration: Math.max(state.iterationCount, 1),
        },
      },
    })),

  setArchitectureReady: (payload) =>
    set((state) => ({
      complexityScore: payload.complexityScore ?? state.complexityScore,
      componentList: payload.componentList ?? state.componentList,
      diagramPlan: payload.diagramPlan ?? state.diagramPlan,
      docPlan: payload.docPlan ?? state.docPlan,
      totalDiagrams: payload.totalDiagrams ?? state.totalDiagrams,
      phaseLabel: payload.message ?? state.phaseLabel,
      agentStates: {
        ...state.agentStates,
        architect: {
          ...state.agentStates.architect,
          state: "active",
          currentTask: payload.message ?? "Architecture drafted",
          lastIteration: Math.max(state.iterationCount, 1),
        },
      },
    })),

  setDocPlan: (payload) =>
    set((state) => {
      const docPlan = payload.docPlan ?? state.docPlan;
      const existing = new Map(state.generatedDocs.map((item) => [item.doc_slug, item]));
      const nextDocs = docPlan.map((slug) => existing.get(slug) ?? { doc_slug: slug, status: "pending" as const });

      return {
        docPlan,
        totalDocs: payload.totalDocs ?? state.totalDocs,
        generatedDocs: nextDocs,
        phaseLabel: payload.message ?? state.phaseLabel,
      };
    }),

  updateDocItem: (payload) =>
    set((state) => {
      if (!payload.slug) {
        return state;
      }

      const existing = state.generatedDocs.find((item) => item.doc_slug === payload.slug);
      const nextDoc: DocEntry = {
        doc_slug: payload.slug,
        title: payload.title ?? existing?.title,
        path: payload.path ?? existing?.path,
        status: payload.status,
      };
      const nextDocs = existing
        ? state.generatedDocs.map((item) => (item.doc_slug === payload.slug ? nextDoc : item))
        : [...state.generatedDocs, nextDoc];

      return {
        generatedDocs: nextDocs,
        completedDocs: payload.completedDocs ?? state.completedDocs,
        totalDocs: payload.totalDocs ?? state.totalDocs,
      };
    }),

  updateDiagramItem: (payload) =>
    set((state) => {
      if (!payload.type) {
        return state;
      }

      const existing = state.generatedDiagrams.find((item) => item.diagram_type === payload.type);
      const nextDiagram: DiagramEntry = {
        diagram_type: payload.type,
        path: payload.path ?? existing?.path,
        status: payload.status,
      };
      const nextDiagrams = existing
        ? state.generatedDiagrams.map((item) => (item.diagram_type === payload.type ? nextDiagram : item))
        : [...state.generatedDiagrams, nextDiagram];

      return {
        generatedDiagrams: nextDiagrams,
        completedDiagrams: payload.completedDiagrams ?? state.completedDiagrams,
        totalDiagrams: payload.totalDiagrams ?? state.totalDiagrams,
      };
    }),

  setReviewerState: (agent, payload) =>
    set((state) => {
      const verdictState =
        payload.verdict === "APPROVED"
          ? "approved"
          : payload.verdict === "REJECTED"
            ? "rejected"
            : payload.reviewing
              ? "active"
              : "idle";
      const label =
        payload.message ??
        (payload.reviewing
          ? `${agent === "scalability" ? "Scalability" : "Security"} review in progress...`
          : state.phaseLabel);

      return {
        iterationCount: payload.iteration ?? state.iterationCount,
        phaseLabel: label,
        scalabilityVerdict:
          agent === "scalability" && payload.verdict ? payload.verdict : state.scalabilityVerdict,
        securityVerdict:
          agent === "security" && payload.verdict ? payload.verdict : state.securityVerdict,
        agentStates: {
          ...state.agentStates,
          [agent]: {
            ...state.agentStates[agent],
            state: verdictState,
            currentTask: payload.message ?? state.agentStates[agent].currentTask,
            lastIteration: payload.iteration ?? state.agentStates[agent].lastIteration,
          },
        },
      };
    }),

  finalizeRun: (payload) =>
    set((state) => ({
      stage: "complete",
      sessionStatus: "complete",
      phaseLabel: "Run complete",
      complexityScore: payload.complexityScore ?? state.complexityScore,
      iterationCount: payload.iterationCount ?? state.iterationCount,
      totalDiagrams: payload.diagramCount ?? state.totalDiagrams,
      totalDocs: payload.docCount ?? state.totalDocs,
      completedDiagrams: payload.diagramCount ?? state.completedDiagrams,
      completedDocs: payload.docCount ?? state.completedDocs,
      generatedDiagrams:
        payload.diagrams?.map((diagram) => ({
          diagram_type: diagram.type,
          path: diagram.path,
          status: "done",
        })) ?? state.generatedDiagrams,
      generatedDocs:
        payload.docs?.map((doc) => ({
          doc_slug: doc.path.split("/").pop() ?? doc.title,
          title: doc.title,
          path: doc.path,
          status: "done",
        })) ?? state.generatedDocs,
      scalabilityVerdict: payload.scalabilityVerdict ?? state.scalabilityVerdict,
      securityVerdict: payload.securityVerdict ?? state.securityVerdict,
      agentStates: {
        architect: {
          ...state.agentStates.architect,
          state: "approved",
          currentTask: "Architecture finalized",
          lastIteration: payload.iterationCount ?? state.iterationCount,
        },
        scalability: {
          ...state.agentStates.scalability,
          state:
            (payload.scalabilityVerdict ?? state.scalabilityVerdict) === "REJECTED" ? "rejected" : "approved",
          currentTask: payload.scalabilityVerdict ?? state.scalabilityVerdict ?? "",
          lastIteration: payload.iterationCount ?? state.iterationCount,
        },
        security: {
          ...state.agentStates.security,
          state:
            (payload.securityVerdict ?? state.securityVerdict) === "REJECTED" ? "rejected" : "approved",
          currentTask: payload.securityVerdict ?? state.securityVerdict ?? "",
          lastIteration: payload.iterationCount ?? state.iterationCount,
        },
      },
      connection: {
        ...state.connection,
        connected: false,
        reconnecting: false,
      },
      errorMessage: null,
    })),

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
        return { settings: { ...defaultSettings, ...parsed } };
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
        status: toHistoryStatus(state.sessionStatus),
        diagramsCount: state.totalDiagrams || state.generatedDiagrams.length,
        docsCount: state.totalDocs || state.generatedDocs.length,
        snapshot: snapshotFromState(state),
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
        return { sessionHistory: JSON.parse(raw) as SessionHistoryItem[] };
      } catch {
        return { sessionHistory: [] };
      }
    }),

  hydrateSessionFromHistory: (threadId) =>
    set((state) => {
      const match = state.sessionHistory.find((item) => item.threadId === threadId);
      if (!match?.snapshot) {
        return state;
      }

      const snapshot = match.snapshot;
      return {
        ...state,
        ...initialState(),
        settings: state.settings,
        sessionHistory: state.sessionHistory,
        threadId: match.threadId,
        requirement: match.requirement,
        sessionStatus:
          match.status === "Complete" ? "complete" : match.status === "Failed" ? "failed" : "running",
        stage: snapshot.stage,
        phaseLabel: snapshot.phaseLabel,
        iterationCount: snapshot.iterationCount,
        maxIterations: snapshot.maxIterations,
        complexityScore: snapshot.complexityScore,
        componentList: snapshot.componentList,
        diagramPlan: snapshot.diagramPlan,
        docPlan: snapshot.docPlan,
        totalDiagrams: snapshot.totalDiagrams,
        completedDiagrams: snapshot.completedDiagrams,
        totalDocs: snapshot.totalDocs,
        completedDocs: snapshot.completedDocs,
        generatedDiagrams: snapshot.generatedDiagrams,
        generatedDocs: snapshot.generatedDocs,
        scalabilityVerdict: snapshot.scalabilityVerdict,
        securityVerdict: snapshot.securityVerdict,
        timeoutMessage: snapshot.timeoutMessage,
      };
    }),
}));

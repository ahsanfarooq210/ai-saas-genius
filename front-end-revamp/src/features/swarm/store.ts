import { create } from "zustand";
import type {
  AgentStatePatch,
  DiagramEntry,
  DocEntry,
  ProgressEventPayload,
  ProgressFeedItem,
  ReviewVerdict,
  SessionHistoryItem,
  SessionSnapshot,
  SessionStatus,
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
  threadName: string | null;
  requirement: string;
  sessionStatus: SessionStatus;
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
  timeoutMessage: string | null;
  errorMessage: string | null;
  authError: boolean;
  architectureJson: Record<string, unknown> | null;
  currentArchitectureMermaid: string | null;
  rawState: Record<string, unknown>;
  progressFeed: ProgressFeedItem[];
  connection: {
    connected: boolean;
    reconnecting: boolean;
    attempts: number;
    maxAttempts: number;
    permanentlyFailed: boolean;
  };
  settings: SettingsState;
  sessionHistory: SessionHistoryItem[];
  startSession: (threadId: string, requirement: string, threadName?: string | null) => void;
  resetForNewSession: () => void;
  setSessionStatus: (status: SessionStatus) => void;
  setConnection: (connected: boolean) => void;
  setReconnecting: (reconnecting: boolean, attempts: number, failed: boolean) => void;
  setAuthFailure: (message?: string | null) => void;
  setStreamError: (message: string) => void;
  setTimeoutMessage: (message: string | null) => void;
  clearTransientMessages: () => void;
  mergeStateUpdate: (payload: AgentStatePatch) => void;
  appendProgressEvent: (threadId: string, payload: ProgressEventPayload) => void;
  updateSettings: (settings: Partial<SettingsState>) => void;
  hydrateSettings: () => void;
  saveSessionHistoryItem: () => void;
  hydrateSessionHistory: () => void;
  hydrateSessionFromHistory: (threadId: string) => void;
}

const SETTINGS_STORAGE_KEY = "swarm_settings";
const HISTORY_STORAGE_KEY = "swarm_history";
const MAX_PROGRESS_FEED_ITEMS = 40;

const defaultSettings: SettingsState = {
  openAiApiKey: "",
  langSmithApiKey: "",
  backendUrl: (import.meta.env.VITE_SERVER_URL as string | undefined) ?? "http://localhost:8000",
  soundEnabled: true,
  autoScrollDebate: true,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toStringOrNull = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

const toNumberOrNull = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
};

const toStringArray = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];

const deepMerge = (target: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> => {
  const merged: Record<string, unknown> = { ...target };

  Object.entries(patch).forEach(([key, value]) => {
    if (value === undefined) {
      return;
    }

    if (isRecord(value) && isRecord(merged[key])) {
      merged[key] = deepMerge(merged[key] as Record<string, unknown>, value);
      return;
    }

    merged[key] = value;
  });

  return merged;
};

const normalizeVerdict = (value: unknown): ReviewVerdict | null => {
  if (value === "APPROVED" || value === "REJECTED") {
    return value;
  }
  return null;
};

const stringifyFeedback = (value: unknown): string | null => {
  if (typeof value === "string" && value.trim()) {
    return value;
  }

  if (!isRecord(value)) {
    return null;
  }

  const directMessage = [value.message, value.summary, value.feedback, value.details].find(
    (entry) => typeof entry === "string" && entry.trim(),
  );
  if (typeof directMessage === "string") {
    return directMessage;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return null;
  }
};

const verdictFromFeedback = (value: unknown): ReviewVerdict | null => {
  if (isRecord(value)) {
    return normalizeVerdict(value.verdict);
  }
  return normalizeVerdict(value);
};

const normalizeDiagramEntry = (value: unknown): DiagramEntry | null => {
  if (typeof value === "string" && value.trim()) {
    return {
      diagram_type: value,
      status: "pending",
    };
  }

  if (!isRecord(value)) {
    return null;
  }

  const diagramType =
    toStringOrNull(value.diagram_type) ??
    toStringOrNull(value.type) ??
    toStringOrNull(value.name) ??
    toStringOrNull(value.label);

  if (!diagramType) {
    return null;
  }

  const rawStatus = toStringOrNull(value.status);
  const status: DiagramEntry["status"] =
    rawStatus === "done" || rawStatus === "generating" || rawStatus === "failed" || rawStatus === "pending"
      ? rawStatus
      : toStringOrNull(value.path)
        ? "done"
        : "pending";

  return {
    diagram_type: diagramType,
    path: toStringOrNull(value.path) ?? undefined,
    status,
  };
};

const normalizeDocEntry = (value: unknown): DocEntry | null => {
  if (typeof value === "string" && value.trim()) {
    return {
      doc_slug: value,
      status: "pending",
    };
  }

  if (!isRecord(value)) {
    return null;
  }

  const slug =
    toStringOrNull(value.doc_slug) ??
    toStringOrNull(value.slug) ??
    toStringOrNull(value.title) ??
    toStringOrNull(value.name);

  if (!slug) {
    return null;
  }

  const rawStatus = toStringOrNull(value.status);
  const status: DocEntry["status"] =
    rawStatus === "done" || rawStatus === "generating" || rawStatus === "pending"
      ? rawStatus
      : toStringOrNull(value.path)
        ? "done"
        : "pending";

  return {
    doc_slug: slug,
    title: toStringOrNull(value.title) ?? undefined,
    path: toStringOrNull(value.path) ?? undefined,
    status,
  };
};

const inferStage = (currentStage: string | null, sessionStatus: SessionStatus): SwarmStage => {
  if (sessionStatus === "failed") {
    return "error";
  }

  if (!currentStage) {
    return sessionStatus === "starting" ? "starting" : sessionStatus === "complete" ? "complete" : "running";
  }

  const normalized = currentStage.toLowerCase();
  if (["done", "complete", "completed", "finished"].includes(normalized)) {
    return "complete";
  }
  if (normalized.includes("error") || normalized.includes("failed")) {
    return "error";
  }
  return "running";
};

const isTerminalStage = (currentStage: string | null) => {
  if (!currentStage) {
    return false;
  }

  return ["done", "complete", "completed", "finished"].includes(currentStage.toLowerCase());
};

const toHistoryStatus = (status: SessionStatus): SessionHistoryItem["status"] => {
  if (status === "complete") {
    return "Complete";
  }
  if (status === "failed") {
    return "Failed";
  }
  return "Running";
};

const initialState = () => ({
  threadId: null as string | null,
  threadName: null as string | null,
  requirement: "",
  sessionStatus: "idle" as SessionStatus,
  stage: "idle" as SwarmStage,
  currentStage: null as string | null,
  currentTask: null as string | null,
  progressMessage: "Awaiting session start" as string | null,
  activeItemType: null as string | null,
  activeItemName: null as string | null,
  iterationCount: 0,
  maxIterations: 5,
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
  scalabilityFeedback: null as string | null,
  securityFeedback: null as string | null,
  timeoutMessage: null as string | null,
  errorMessage: null as string | null,
  authError: false,
  architectureJson: null as Record<string, unknown> | null,
  currentArchitectureMermaid: null as string | null,
  rawState: {} as Record<string, unknown>,
  progressFeed: [] as ProgressFeedItem[],
  connection: {
    connected: false,
    reconnecting: false,
    attempts: 0,
    maxAttempts: 3,
    permanentlyFailed: false,
  },
});

const snapshotFromState = (state: SwarmStoreState): SessionSnapshot => ({
  stage: state.stage,
  currentStage: state.currentStage,
  currentTask: state.currentTask,
  progressMessage: state.progressMessage,
  activeItemType: state.activeItemType,
  activeItemName: state.activeItemName,
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
  scalabilityFeedback: state.scalabilityFeedback,
  securityFeedback: state.securityFeedback,
  architectureJson: state.architectureJson,
  currentArchitectureMermaid: state.currentArchitectureMermaid,
  timeoutMessage: state.timeoutMessage,
  rawState: state.rawState,
  progressFeed: state.progressFeed,
});

export const useSwarmStore = create<SwarmStoreState>((set) => ({
  ...initialState(),
  settings: defaultSettings,
  sessionHistory: [],

  startSession: (threadId, requirement, threadName) =>
    set((state) => ({
      ...state,
      ...initialState(),
      threadId,
      threadName: threadName ?? null,
      requirement,
      sessionStatus: "starting",
      stage: "starting",
      progressMessage: "Creating thread and opening stream...",
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

  setSessionStatus: (status) =>
    set((state) => ({
      sessionStatus: status,
      stage: inferStage(state.currentStage, status),
    })),

  setConnection: (connected) =>
    set((state) => ({
      connection: {
        ...state.connection,
        connected,
        reconnecting: false,
        attempts: connected ? 0 : state.connection.attempts,
        permanentlyFailed: false,
      },
      authError: false,
      timeoutMessage: connected ? null : state.timeoutMessage,
      errorMessage: connected ? null : state.errorMessage,
      sessionStatus:
        connected && (state.sessionStatus === "idle" || state.sessionStatus === "starting")
          ? "running"
          : state.sessionStatus,
      stage: connected
        ? inferStage(state.currentStage, state.sessionStatus === "starting" ? "running" : state.sessionStatus)
        : state.stage,
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
        ? "Live updates stopped after repeated reconnect attempts. Reopen the thread to resume from the last checkpoint."
        : state.errorMessage,
      sessionStatus: failed ? "failed" : state.sessionStatus,
      stage: failed ? "error" : state.stage,
    })),

  setAuthFailure: (message) =>
    set((state) => ({
      authError: true,
      errorMessage: message ?? "Authentication expired. Sign in again to continue the swarm stream.",
      sessionStatus: "failed",
      stage: "error",
      connection: {
        ...state.connection,
        connected: false,
        reconnecting: false,
        permanentlyFailed: true,
      },
    })),

  setStreamError: (message) =>
    set((state) => ({
      errorMessage: message,
      sessionStatus: "failed",
      stage: "error",
      connection: {
        ...state.connection,
        connected: false,
        reconnecting: false,
        permanentlyFailed: true,
      },
    })),

  setTimeoutMessage: (message) => set(() => ({ timeoutMessage: message })),

  clearTransientMessages: () =>
    set(() => ({
      timeoutMessage: null,
      errorMessage: null,
      authError: false,
    })),

  mergeStateUpdate: (payload) =>
    set((state) => {
      const rawState = deepMerge(state.rawState, payload);
      const nextThreadId = toStringOrNull(payload.thread_id) ?? state.threadId;
      const nextRequirement = toStringOrNull(payload.task_requirement) ?? state.requirement;
      const currentStage = toStringOrNull(payload.current_stage) ?? toStringOrNull(rawState.current_stage) ?? state.currentStage;
      const progressMessage =
        toStringOrNull(payload.progress_message) ??
        toStringOrNull(rawState.progress_message) ??
        toStringOrNull(payload.current_task) ??
        state.progressMessage;
      const currentTask = toStringOrNull(payload.current_task) ?? toStringOrNull(rawState.current_task) ?? state.currentTask;
      const activeItemType =
        toStringOrNull(payload.active_item_type) ?? toStringOrNull(rawState.active_item_type) ?? state.activeItemType;
      const activeItemName =
        toStringOrNull(payload.active_item_name) ?? toStringOrNull(rawState.active_item_name) ?? state.activeItemName;
      const componentList = payload.component_list ? toStringArray(payload.component_list) : state.componentList;
      const diagramPlan = payload.diagram_plan ? toStringArray(payload.diagram_plan) : state.diagramPlan;
      const docPlan = payload.doc_plan ? toStringArray(payload.doc_plan) : state.docPlan;
      const generatedDiagrams = Array.isArray(payload.generated_diagrams)
        ? payload.generated_diagrams.map(normalizeDiagramEntry).filter((item): item is DiagramEntry => Boolean(item))
        : state.generatedDiagrams;
      const generatedDocs = Array.isArray(payload.generated_docs)
        ? payload.generated_docs.map(normalizeDocEntry).filter((item): item is DocEntry => Boolean(item))
        : state.generatedDocs;
      const architectureJson =
        payload.architecture_json === null
          ? null
          : isRecord(payload.architecture_json)
            ? payload.architecture_json
            : state.architectureJson;
      const scalabilityVerdict = verdictFromFeedback(payload.scalability_feedback) ?? state.scalabilityVerdict;
      const securityVerdict = verdictFromFeedback(payload.security_feedback) ?? state.securityVerdict;
      const sessionStatus = isTerminalStage(currentStage)
        ? "complete"
        : state.sessionStatus === "idle"
          ? "running"
          : state.sessionStatus === "starting"
            ? "running"
            : state.sessionStatus;

      return {
        threadId: nextThreadId,
        requirement: nextRequirement,
        sessionStatus,
        stage: inferStage(currentStage, sessionStatus),
        currentStage,
        currentTask,
        progressMessage,
        activeItemType,
        activeItemName,
        iterationCount: toNumberOrNull(payload.iteration_count) ?? state.iterationCount,
        complexityScore:
          payload.complexity_score === null
            ? null
            : toNumberOrNull(payload.complexity_score) ?? state.complexityScore,
        componentList,
        diagramPlan,
        docPlan,
        totalDiagrams: toNumberOrNull(payload.total_diagram_count) ?? state.totalDiagrams,
        completedDiagrams: toNumberOrNull(payload.completed_diagram_count) ?? state.completedDiagrams,
        totalDocs: toNumberOrNull(payload.total_doc_count) ?? state.totalDocs,
        completedDocs: toNumberOrNull(payload.completed_doc_count) ?? state.completedDocs,
        generatedDiagrams,
        generatedDocs,
        scalabilityVerdict,
        securityVerdict,
        scalabilityFeedback: stringifyFeedback(payload.scalability_feedback) ?? state.scalabilityFeedback,
        securityFeedback: stringifyFeedback(payload.security_feedback) ?? state.securityFeedback,
        architectureJson,
        currentArchitectureMermaid:
          toStringOrNull(payload.current_architecture_mermaid) ?? state.currentArchitectureMermaid,
        rawState,
        errorMessage: null,
        timeoutMessage: null,
      };
    }),

  appendProgressEvent: (threadId, payload) =>
    set((state) => {
      if (state.threadId && state.threadId !== threadId) {
        return state;
      }

      const idSource =
        toStringOrNull(payload.event) ??
        toStringOrNull(payload.stage) ??
        toStringOrNull(payload.status) ??
        "progress";

      const nextEntry: ProgressFeedItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${idSource}`,
        timestamp: new Date().toISOString(),
        event: toStringOrNull(payload.event) ?? undefined,
        type: toStringOrNull(payload.type) ?? undefined,
        stage: toStringOrNull(payload.stage) ?? undefined,
        status: toStringOrNull(payload.status) ?? undefined,
        message: toStringOrNull(payload.message) ?? undefined,
        payload,
      };

      const nextFeed = [nextEntry, ...state.progressFeed].slice(0, MAX_PROGRESS_FEED_ITEMS);
      const nextThreadId = state.threadId ?? threadId;
      const stageFromProgress = toStringOrNull(payload.stage) ?? state.currentStage;

      return {
        threadId: nextThreadId,
        progressFeed: nextFeed,
        currentStage: stageFromProgress,
        progressMessage: toStringOrNull(payload.message) ?? state.progressMessage,
        currentTask: toStringOrNull(payload.message) ?? state.currentTask,
        stage: inferStage(stageFromProgress, state.sessionStatus === "idle" ? "running" : state.sessionStatus),
        sessionStatus: state.sessionStatus === "idle" ? "running" : state.sessionStatus,
      };
    }),

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
        threadName: state.threadName,
        sessionStatus:
          match.status === "Complete" ? "complete" : match.status === "Failed" ? "failed" : "running",
        stage: snapshot.stage,
        currentStage: snapshot.currentStage,
        currentTask: snapshot.currentTask,
        progressMessage: snapshot.progressMessage,
        activeItemType: snapshot.activeItemType,
        activeItemName: snapshot.activeItemName,
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
        scalabilityFeedback: snapshot.scalabilityFeedback,
        securityFeedback: snapshot.securityFeedback,
        architectureJson: snapshot.architectureJson,
        currentArchitectureMermaid: snapshot.currentArchitectureMermaid,
        timeoutMessage: snapshot.timeoutMessage,
        rawState: snapshot.rawState,
        progressFeed: snapshot.progressFeed,
      };
    }),
}));

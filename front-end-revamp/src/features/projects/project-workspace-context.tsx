/* eslint-disable react-hooks/refs, react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { isAxiosError } from "axios";
import { toast } from "sonner";

import {
  getSwarmRevision,
  getSwarmSession,
  listSwarmRevisions,
  streamSwarmRevise,
} from "@/api/swarm";
import type {
  SwarmProgressEvent,
  SwarmRevisionSummary,
  SwarmSessionResponse,
} from "@/api/swarm";
import { getErrorMessage } from "@/lib/api-error";
import { getRecentProject, saveRecentProject } from "./project-storage";
import {
  normalizeCurrentSession,
  normalizeHistoricalRevision,
  type ArchitectureWorkspaceModel,
} from "./workspace-model";

type StreamStatus =
  | "idle"
  | "connecting"
  | "streaming"
  | "finishing"
  | "done"
  | "error"
  | "cancelled";

type ProjectWorkspaceContextValue = {
  session: SwarmSessionResponse | null;
  currentWorkspace: ArchitectureWorkspaceModel | null;
  visibleWorkspace: ArchitectureWorkspaceModel | null;
  viewedRevision: ArchitectureWorkspaceModel | null;
  selectedFailedRevision: SwarmRevisionSummary | null;
  revisions: SwarmRevisionSummary[];
  currentRevision: number;
  localTitle: string;
  isLoading: boolean;
  isLoadingHistory: boolean;
  isSubmittingRevision: boolean;
  streamStatus: StreamStatus;
  streamEvents: SwarmProgressEvent[];
  streamError: string | null;
  unavailable: boolean;
  refresh: () => Promise<void>;
  submitRevision: (instruction: string) => void;
  cancelOperation: () => void;
  viewRevision: (revision: SwarmRevisionSummary) => Promise<void>;
  returnToCurrent: () => void;
};

const ProjectWorkspaceContext = createContext<
  ProjectWorkspaceContextValue | undefined
>(undefined);

function statusCode(error: unknown): number | undefined {
  return isAxiosError(error) ? error.response?.status : undefined;
}

export function ProjectWorkspaceProvider({
  threadId,
  children,
}: {
  threadId: string;
  children: ReactNode;
}) {
  const [session, setSession] = useState<SwarmSessionResponse | null>(null);
  const [revisions, setRevisions] = useState<SwarmRevisionSummary[]>([]);
  const [currentRevision, setCurrentRevision] = useState(0);
  const [viewedRevision, setViewedRevision] =
    useState<ArchitectureWorkspaceModel | null>(null);
  const [selectedFailedRevision, setSelectedFailedRevision] =
    useState<SwarmRevisionSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isSubmittingRevision, setIsSubmittingRevision] = useState(false);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("idle");
  const [streamEvents, setStreamEvents] = useState<SwarmProgressEvent[]>([]);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const localProject = getRecentProject(threadId);

  const loadHistory = useCallback(
    async (requestId: number) => {
      setIsLoadingHistory(true);
      try {
        const value = await listSwarmRevisions(threadId);
        if (requestId !== requestIdRef.current) return;
        setRevisions(value.revisions);
        setCurrentRevision(value.current_revision);
      } finally {
        if (requestId === requestIdRef.current) setIsLoadingHistory(false);
      }
    },
    [threadId],
  );

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setUnavailable(false);
    try {
      const nextSession = await getSwarmSession(threadId);
      if (requestId !== requestIdRef.current) return;
      setSession(nextSession);
      setCurrentRevision(nextSession.revision_number);
      saveRecentProject({
        ...getRecentProject(threadId),
        threadId,
        requirement: nextSession.requirement,
        currentRevision: nextSession.revision_number,
        lastOpenedAt: new Date().toISOString(),
        lastCompletedAt: nextSession.completed_at ?? undefined,
      });
      await loadHistory(requestId);
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      if (statusCode(error) === 404) setUnavailable(true);
      setStreamError(
        getErrorMessage(error, "Could not load this architecture project."),
      );
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, [loadHistory, threadId]);

  useEffect(() => {
    void Promise.resolve().then(refresh);
    return () => {
      requestIdRef.current += 1;
      controllerRef.current?.abort();
    };
  }, [refresh]);

  const handleRevisionFailure = useCallback(
    async (message: string) => {
      setIsSubmittingRevision(false);
      setStreamStatus("error");
      setStreamError(message);
      toast.error("Revision failed", { description: message });
      const requestId = ++requestIdRef.current;
      try {
        const [nextSession] = await Promise.all([
          getSwarmSession(threadId),
          loadHistory(requestId),
        ]);
        if (requestId === requestIdRef.current) setSession(nextSession);
      } catch {
        // Preserve the existing workspace when recovery inspection also fails.
      }
    },
    [loadHistory, threadId],
  );

  const submitRevision = useCallback(
    (rawInstruction: string) => {
      const instruction = rawInstruction.trim();
      if (!instruction || !threadId || isSubmittingRevision) return;
      const previousRevision = session?.revision_number ?? 0;
      setIsSubmittingRevision(true);
      setStreamStatus("connecting");
      setStreamError(null);
      setStreamEvents([]);
      setViewedRevision(null);
      setSelectedFailedRevision(null);

      controllerRef.current = streamSwarmRevise(
        { thread_id: threadId, instruction },
        {
          onProgress: (event) => {
            if (event.thread_id !== threadId) return;
            setStreamStatus("streaming");
            setStreamEvents((events) => [...events, event]);
          },
          onDone: (event) => {
            if (event.thread_id !== threadId) return;
            setStreamStatus("finishing");
            const requestId = ++requestIdRef.current;
            void Promise.all([
              getSwarmSession(threadId),
              listSwarmRevisions(threadId),
            ])
              .then(([nextSession, history]) => {
                if (requestId !== requestIdRef.current) return;
                if (nextSession.revision_number <= previousRevision)
                  throw new Error(
                    "The operation completed but no newer successful revision was promoted.",
                  );
                setSession(nextSession);
                setRevisions(history.revisions);
                setCurrentRevision(history.current_revision);
                setStreamStatus("done");
                setStreamError(null);
                saveRecentProject({
                  ...getRecentProject(threadId),
                  threadId,
                  requirement: nextSession.requirement,
                  currentRevision: nextSession.revision_number,
                  lastOpenedAt: new Date().toISOString(),
                  lastCompletedAt:
                    nextSession.completed_at ?? new Date().toISOString(),
                });
                toast.success(
                  `Revision ${nextSession.revision_number} is ready`,
                );
              })
              .catch(
                (error: unknown) =>
                  void handleRevisionFailure(
                    error instanceof Error
                      ? error.message
                      : "Could not load the completed revision.",
                  ),
              )
              .finally(() => setIsSubmittingRevision(false));
          },
          onError: (event) => {
            if (event.thread_id === threadId)
              void handleRevisionFailure(event.message);
          },
        },
      );
    },
    [
      handleRevisionFailure,
      isSubmittingRevision,
      session?.revision_number,
      threadId,
    ],
  );

  const cancelOperation = useCallback(() => {
    controllerRef.current?.abort();
    setIsSubmittingRevision(false);
    setStreamStatus("cancelled");
    setStreamError(
      "The browser stopped listening. The backend may still be running; refresh the project to inspect its state.",
    );
  }, []);

  const viewRevision = useCallback(
    async (revision: SwarmRevisionSummary) => {
      if (revision.status === "failed") {
        setViewedRevision(null);
        setSelectedFailedRevision(revision);
        return;
      }
      if (
        revision.status !== "done" ||
        revision.revision_number === currentRevision
      ) {
        setViewedRevision(null);
        setSelectedFailedRevision(null);
        return;
      }
      setSelectedFailedRevision(null);
      const requestId = ++requestIdRef.current;
      try {
        const detail = await getSwarmRevision(
          threadId,
          revision.revision_number,
        );
        if (requestId !== requestIdRef.current) return;
        setViewedRevision(normalizeHistoricalRevision(detail));
      } catch (error) {
        if (requestId === requestIdRef.current)
          toast.error(getErrorMessage(error, "Could not load that revision."));
      }
    },
    [currentRevision, threadId],
  );

  const returnToCurrent = useCallback(() => {
    setViewedRevision(null);
    setSelectedFailedRevision(null);
  }, []);

  const currentWorkspace = useMemo(
    () => (session ? normalizeCurrentSession(session) : null),
    [session],
  );
  const value = useMemo<ProjectWorkspaceContextValue>(
    () => ({
      session,
      currentWorkspace,
      visibleWorkspace: viewedRevision ?? currentWorkspace,
      viewedRevision,
      selectedFailedRevision,
      revisions,
      currentRevision,
      localTitle:
        localProject?.localTitle ??
        localProject?.requirement ??
        session?.requirement ??
        "Architecture project",
      isLoading,
      isLoadingHistory,
      isSubmittingRevision,
      streamStatus,
      streamEvents,
      streamError,
      unavailable,
      refresh,
      submitRevision,
      cancelOperation,
      viewRevision,
      returnToCurrent,
    }),
    [
      cancelOperation,
      currentRevision,
      currentWorkspace,
      isLoading,
      isLoadingHistory,
      isSubmittingRevision,
      localProject?.localTitle,
      localProject?.requirement,
      refresh,
      revisions,
      selectedFailedRevision,
      session,
      streamError,
      streamEvents,
      streamStatus,
      submitRevision,
      unavailable,
      viewRevision,
      viewedRevision,
      returnToCurrent,
    ],
  );

  return (
    <ProjectWorkspaceContext.Provider value={value}>
      {children}
    </ProjectWorkspaceContext.Provider>
  );
}

export function useProjectWorkspace(): ProjectWorkspaceContextValue {
  const context = useContext(ProjectWorkspaceContext);
  if (!context)
    throw new Error(
      "useProjectWorkspace must be used inside ProjectWorkspaceProvider",
    );
  return context;
}

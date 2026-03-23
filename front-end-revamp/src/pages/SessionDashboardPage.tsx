import { useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Copy,
  Loader2,
  TriangleAlert,
  Workflow,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { useSwarmStore } from "@/features/swarm/store";
import { closeAgentStream, openAgentStream } from "@/features/swarm/sse";
import type { DiagramEntry, DocEntry, ReviewVerdict, WorkItemStatus } from "@/features/swarm/types";

const verdictStyles: Record<ReviewVerdict, string> = {
  APPROVED: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  REJECTED: "border-rose-500/40 bg-rose-500/10 text-rose-300",
};

const statusLabel = (status: WorkItemStatus) => {
  if (status === "pending") {
    return "Pending";
  }
  if (status === "generating") {
    return "Generating";
  }
  if (status === "done") {
    return "Done";
  }
  return "Failed";
};

const complexityTone = (score: number | null) => {
  if (score === null) {
    return { label: null, className: "border-border text-muted-foreground" };
  }
  if (score <= 3) {
    return { label: "Simple system", className: "border-emerald-500/40 text-emerald-300" };
  }
  if (score <= 6) {
    return { label: "Moderate", className: "border-amber-500/40 text-amber-300" };
  }
  return { label: "Complex distributed system", className: "border-rose-500/40 text-rose-300" };
};

const progressValue = (completed: number, total: number) => (total > 0 ? (completed / total) * 100 : 0);

const ItemStatusIcon = ({ status }: { status: WorkItemStatus }) => {
  if (status === "generating") {
    return <Spinner className="h-4 w-4 text-sky-300" />;
  }
  if (status === "done") {
    return <CheckCircle2 className="h-4 w-4 text-emerald-300" />;
  }
  if (status === "failed") {
    return <TriangleAlert className="h-4 w-4 text-amber-300" />;
  }
  return <Circle className="h-4 w-4 text-muted-foreground" />;
};

const ItemRow = ({
  label,
  status,
  path,
}: {
  label: string;
  status: WorkItemStatus;
  path?: string;
}) => (
  <div className="flex items-center justify-between rounded-xl border border-border/70 bg-background px-3 py-2">
    <div className="min-w-0">
      <p className="truncate text-sm text-foreground">{label}</p>
      {path ? <p className="truncate text-xs text-muted-foreground">{path}</p> : null}
    </div>
    <div className="ml-3 flex items-center gap-2">
      <span className="text-xs text-muted-foreground">{statusLabel(status)}</span>
      <ItemStatusIcon status={status} />
    </div>
  </div>
);

const FinalOutputList = ({
  title,
  items,
}: {
  title: string;
  items: Array<{ label: string; path: string }>;
}) => (
  <section className="rounded-xl border border-border/70 bg-card p-4">
    <h3 className="text-sm font-semibold text-foreground">{title}</h3>
    <div className="mt-3 space-y-2">
      {items.map((item) => (
        <div
          key={`${title}-${item.path}`}
          className="flex items-center justify-between rounded-xl border border-border/70 bg-background px-3 py-2"
        >
          <div className="min-w-0">
            <p className="truncate text-sm text-foreground">{item.label}</p>
            <p className="truncate text-xs text-muted-foreground">{item.path}</p>
          </div>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(item.path);
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-1.5 text-xs text-foreground"
          >
            <Copy className="h-3.5 w-3.5" />
            Copy Path
          </button>
        </div>
      ))}
    </div>
  </section>
);

const reviewTitle = (label: string, verdict: ReviewVerdict | null, feedback: string | null) => (
  <section className="rounded-xl border border-border/70 bg-card p-4">
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-sm font-semibold text-foreground">{label}</h3>
      {verdict ? <span className={`rounded-full border px-3 py-1 text-xs ${verdictStyles[verdict]}`}>{verdict}</span> : null}
    </div>
    <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
      {feedback ?? "No review feedback has been emitted yet."}
    </p>
  </section>
);

const SessionDashboardPage = () => {
  const { threadId: routeThreadId } = useParams();
  const {
    threadId,
    threadName,
    requirement,
    stage,
    sessionStatus,
    iterationCount,
    maxIterations,
    currentStage,
    currentTask,
    progressMessage,
    activeItemType,
    activeItemName,
    complexityScore,
    generatedDocs,
    generatedDiagrams,
    totalDocs,
    completedDocs,
    totalDiagrams,
    completedDiagrams,
    scalabilityVerdict,
    securityVerdict,
    scalabilityFeedback,
    securityFeedback,
    connection,
    timeoutMessage,
    errorMessage,
    progressFeed,
    hydrateSessionHistory,
    hydrateSessionFromHistory,
    sessionHistory,
    saveSessionHistoryItem,
  } = useSwarmStore();

  const currentThreadId = routeThreadId ?? threadId;
  const complexity = complexityTone(complexityScore);
  const statusTitle = progressMessage ?? currentTask ?? currentStage ?? "Waiting to begin...";

  useEffect(() => {
    hydrateSessionHistory();
  }, [hydrateSessionHistory]);

  useEffect(() => {
    if (!routeThreadId || routeThreadId === threadId) {
      return;
    }

    const historyMatch = sessionHistory.find((item) => item.threadId === routeThreadId);
    if (historyMatch?.snapshot) {
      hydrateSessionFromHistory(routeThreadId);
    }
  }, [hydrateSessionFromHistory, routeThreadId, sessionHistory, threadId]);

  useEffect(() => {
    if (!currentThreadId || sessionStatus === "complete" || sessionStatus === "failed") {
      return;
    }

    const ownerId = `session-dashboard:${currentThreadId}`;
    const shouldStartNewRun = threadId === currentThreadId && sessionStatus === "starting";

    openAgentStream({
      ownerId,
      threadId: currentThreadId,
      taskRequirement: shouldStartNewRun ? requirement : undefined,
    });

    return () => {
      closeAgentStream(currentThreadId, ownerId);
    };
  }, [currentThreadId, requirement, sessionStatus, threadId]);

  useEffect(() => {
    if (sessionStatus === "complete" || sessionStatus === "failed") {
      saveSessionHistoryItem();
    }
  }, [saveSessionHistoryItem, sessionStatus]);

  const finalDocItems = useMemo(
    () =>
      generatedDocs
        .filter((item): item is DocEntry & { path: string } => Boolean(item.path))
        .map((item) => ({
          label: item.title ?? item.doc_slug,
          path: item.path,
        })),
    [generatedDocs],
  );

  const finalDiagramItems = useMemo(
    () =>
      generatedDiagrams
        .filter((item): item is DiagramEntry & { path: string } => Boolean(item.path))
        .map((item) => ({
          label: item.diagram_type,
          path: item.path,
        })),
    [generatedDiagrams],
  );

  const reviewPassLabel = `Iteration ${Math.max(iterationCount, 1)} of ${maxIterations}`;

  return (
    <section className="mx-auto max-w-6xl space-y-4">
      <header className="rounded-2xl border border-border/70 bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Swarm Run</p>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {threadName || (stage === "complete" ? "Architecture package ready" : statusTitle)}
            </h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              {requirement || "No requirement recorded."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {complexity.label ? (
              <span className={`inline-flex rounded-full border px-3 py-1 text-xs ${complexity.className}`}>
                {complexity.label} {complexityScore !== null ? `(${complexityScore}/10)` : ""}
              </span>
            ) : null}
            {currentStage ? <Badge variant="outline">{currentStage}</Badge> : null}
            <Badge variant="outline">{reviewPassLabel}</Badge>
          </div>
        </div>
      </header>

      {connection.reconnecting ? (
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <Loader2 className="h-4 w-4 animate-spin" />
          Reconnecting live stream with checkpoint resume...
        </div>
      ) : null}

      {errorMessage ? (
        <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          <AlertTriangle className="h-4 w-4" />
          {errorMessage}
        </div>
      ) : null}

      {timeoutMessage ? (
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <AlertTriangle className="h-4 w-4" />
          {timeoutMessage}
        </div>
      ) : null}

      {stage !== "complete" ? (
        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="space-y-4 rounded-2xl border border-border/70 bg-card p-5">
            <div className="flex items-center gap-3">
              <Spinner className="h-5 w-5 text-sky-300" />
              <div>
                <h2 className="text-base font-semibold text-foreground">{statusTitle}</h2>
                <p className="text-sm text-muted-foreground">
                  {currentTask || progressMessage || "Waiting for backend state updates..."}
                </p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-border/70 bg-background p-4">
                <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Current Stage</p>
                <p className="mt-2 text-sm text-foreground">{currentStage ?? "Connecting..."}</p>
              </div>
              <div className="rounded-xl border border-border/70 bg-background p-4">
                <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Active Work Item</p>
                <p className="mt-2 text-sm text-foreground">
                  {activeItemType && activeItemName ? `${activeItemType}: ${activeItemName}` : "No active item reported"}
                </p>
              </div>
            </div>

            {totalDiagrams > 0 ? (
              <div className="space-y-3 rounded-xl border border-border/70 bg-background p-4">
                <div className="flex items-center justify-between text-sm">
                  <h3 className="font-medium text-foreground">Diagrams</h3>
                  <span className="text-muted-foreground">
                    {completedDiagrams} / {totalDiagrams}
                  </span>
                </div>
                <Progress value={progressValue(completedDiagrams, totalDiagrams)} />
                <div className="space-y-2">
                  {generatedDiagrams.map((item) => (
                    <ItemRow key={item.diagram_type} label={item.diagram_type} status={item.status} path={item.path} />
                  ))}
                </div>
              </div>
            ) : null}

            {totalDocs > 0 ? (
              <div className="space-y-3 rounded-xl border border-border/70 bg-background p-4">
                <div className="flex items-center justify-between text-sm">
                  <h3 className="font-medium text-foreground">Documents</h3>
                  <span className="text-muted-foreground">
                    {completedDocs} / {totalDocs}
                  </span>
                </div>
                <Progress value={progressValue(completedDocs, totalDocs)} />
                <div className="space-y-2">
                  {generatedDocs.map((item) => (
                    <ItemRow key={item.doc_slug} label={item.title ?? item.doc_slug} status={item.status} path={item.path} />
                  ))}
                </div>
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              {reviewTitle("Scalability Review", scalabilityVerdict, scalabilityFeedback)}
              {reviewTitle("Security Review", securityVerdict, securityFeedback)}
            </div>
          </section>

          <aside className="space-y-4">
            <section className="rounded-2xl border border-border/70 bg-card p-5">
              <h2 className="text-sm font-semibold text-foreground">Live Status</h2>
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-foreground">Connection</span>
                  <span className="text-xs text-muted-foreground">
                    {connection.connected ? "Connected" : connection.reconnecting ? "Reconnecting" : "Idle"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-foreground">Thread</span>
                  <span className="max-w-40 truncate text-xs text-muted-foreground">{currentThreadId ?? "-"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-foreground">Iterations</span>
                  <span className="text-xs text-muted-foreground">{reviewPassLabel}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-foreground">Diagrams planned</span>
                  <span className="text-xs text-muted-foreground">{totalDiagrams || "-"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-foreground">Documents planned</span>
                  <span className="text-xs text-muted-foreground">{totalDocs || "-"}</span>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-border/70 bg-card p-5">
              <div className="flex items-center gap-2">
                <Workflow className="h-4 w-4 text-sky-300" />
                <h2 className="text-sm font-semibold text-foreground">Progress Feed</h2>
              </div>
              <div className="mt-4 space-y-3">
                {progressFeed.length > 0 ? (
                  progressFeed.slice(0, 8).map((item) => (
                    <div key={item.id} className="rounded-xl border border-border/70 bg-background p-3">
                      <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                        {item.stage ? <span>{item.stage}</span> : null}
                        {item.status ? <span>{item.status}</span> : null}
                        {item.type ? <span>{item.type}</span> : null}
                      </div>
                      <p className="mt-2 text-sm text-foreground">{item.message ?? "Progress event received"}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">Progress events will appear here as workers report activity.</p>
                )}
              </div>
            </section>
          </aside>
        </div>
      ) : (
        <div className="space-y-4">
          <section className="rounded-2xl border border-border/70 bg-card p-5">
            <div className="flex flex-wrap items-center gap-2">
              {complexity.label ? (
                <span className={`inline-flex rounded-full border px-3 py-1 text-xs ${complexity.className}`}>
                  {complexity.label} {complexityScore !== null ? `(${complexityScore}/10)` : ""}
                </span>
              ) : null}
              <Badge variant="outline">Iterations: {iterationCount}</Badge>
              {scalabilityVerdict ? (
                <span className={`inline-flex rounded-full border px-3 py-1 text-xs ${verdictStyles[scalabilityVerdict]}`}>
                  Scalability {scalabilityVerdict}
                </span>
              ) : null}
              {securityVerdict ? (
                <span className={`inline-flex rounded-full border px-3 py-1 text-xs ${verdictStyles[securityVerdict]}`}>
                  Security {securityVerdict}
                </span>
              ) : null}
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <FinalOutputList title="Diagrams" items={finalDiagramItems} />
            <FinalOutputList title="Documents" items={finalDocItems} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {reviewTitle("Scalability Review", scalabilityVerdict, scalabilityFeedback)}
            {reviewTitle("Security Review", securityVerdict, securityFeedback)}
          </div>
        </div>
      )}
    </section>
  );
};

export default SessionDashboardPage;

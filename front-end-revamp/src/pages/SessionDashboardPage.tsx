import { useEffect, useMemo, useRef } from "react";
import { useParams } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Copy,
  Loader2,
  Shield,
  TriangleAlert,
  TrendingUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { useSwarmStore } from "@/features/swarm/store";
import { SwarmSseClient } from "@/features/swarm/sse";
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
  return "Skipped";
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

const SessionDashboardPage = () => {
  const { threadId: routeThreadId } = useParams();
  const {
    threadId,
    requirement,
    stage,
    sessionStatus,
    iterationCount,
    maxIterations,
    phaseLabel,
    complexityScore,
    componentList,
    generatedDocs,
    generatedDiagrams,
    totalDocs,
    completedDocs,
    totalDiagrams,
    completedDiagrams,
    scalabilityVerdict,
    securityVerdict,
    connection,
    timeoutMessage,
    errorMessage,
    hydrateSessionHistory,
    hydrateSessionFromHistory,
    sessionHistory,
    saveSessionHistoryItem,
  } = useSwarmStore();

  const currentThreadId = routeThreadId ?? threadId;
  const clientRef = useRef<SwarmSseClient | null>(null);
  const complexity = complexityTone(complexityScore);

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
    if (clientRef.current) {
      return;
    }
    clientRef.current = new SwarmSseClient(currentThreadId);
    clientRef.current.connect();

    return () => {
      clientRef.current?.disconnect();
      clientRef.current = null;
    };
  }, [currentThreadId, sessionStatus]);

  useEffect(() => {
    if (sessionStatus === "complete" || sessionStatus === "failed") {
      saveSessionHistoryItem();
    }
  }, [saveSessionHistoryItem, sessionStatus]);

  const docItems = useMemo(() => generatedDocs, [generatedDocs]);
  const diagramItems = useMemo(() => generatedDiagrams, [generatedDiagrams]);

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

  const reviewPassLabel = `Review pass ${Math.max(iterationCount, 1)} of ${maxIterations}`;

  return (
    <section className="mx-auto max-w-6xl space-y-4">
      <header className="rounded-2xl border border-border/70 bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Swarm Run</p>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {stage === "complete" ? "Architecture package ready" : phaseLabel}
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
            <Badge variant="outline">Iteration {Math.max(iterationCount, 1)}</Badge>
          </div>
        </div>
      </header>

      {connection.reconnecting ? (
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <Loader2 className="h-4 w-4 animate-spin" />
          Reconnecting live stream in 2 seconds...
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
                <h2 className="text-base font-semibold text-foreground">{phaseLabel}</h2>
                <p className="text-sm text-muted-foreground">
                  {stage === "running:architect" && "Drafting architecture..."}
                  {stage === "running:doc_generator" && "Generating documentation..."}
                  {stage === "running:scalability" && "Reviewing architecture — Scalability..."}
                  {stage === "running:security" && "Reviewing architecture — Security..."}
                  {stage === "starting" && "Connecting to the swarm stream..."}
                  {stage === "idle" && "Waiting to begin..."}
                  {stage === "error" && "Live updates stopped."}
                </p>
              </div>
            </div>

            {componentList.length > 0 || complexityScore !== null ? (
              <div className="rounded-xl border border-border/70 bg-background p-4">
                <div className="flex flex-wrap items-center gap-2">
                  {complexity.label ? (
                    <span className={`inline-flex rounded-full border px-3 py-1 text-xs ${complexity.className}`}>
                      {complexity.label}
                    </span>
                  ) : null}
                  <span className="text-xs text-muted-foreground">
                    Planning {totalDiagrams || 0} diagrams, {totalDocs || 0} documents
                  </span>
                </div>
                {componentList.length > 0 ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {componentList.map((component) => (
                      <span
                        key={component}
                        className="rounded-full border border-border bg-card px-3 py-1 text-xs text-foreground"
                      >
                        {component}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {stage === "running:doc_generator" ? (
              <div className="space-y-5">
                {totalDiagrams > 0 ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <h3 className="font-medium text-foreground">Diagrams</h3>
                      <span className="text-muted-foreground">
                        {completedDiagrams} / {totalDiagrams}
                      </span>
                    </div>
                    <Progress value={progressValue(completedDiagrams, totalDiagrams)} />
                    <div className="space-y-2">
                      {diagramItems.map((item) => (
                        <ItemRow
                          key={item.diagram_type}
                          label={item.diagram_type}
                          status={item.status}
                          path={item.path}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}

                {totalDocs > 0 ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <h3 className="font-medium text-foreground">Documents</h3>
                      <span className="text-muted-foreground">
                        {completedDocs} / {totalDocs}
                      </span>
                    </div>
                    <Progress value={progressValue(completedDocs, totalDocs)} />
                    <div className="space-y-2">
                      {docItems.map((item) => (
                        <ItemRow
                          key={item.doc_slug}
                          label={item.title ?? item.doc_slug}
                          status={item.status}
                          path={item.path}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {(stage === "running:scalability" || stage === "running:security") ? (
              <div className="rounded-xl border border-border/70 bg-background p-4">
                <p className="text-sm text-muted-foreground">{reviewPassLabel}</p>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-border/70 bg-card p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <TrendingUp className="h-4 w-4" />
                      Scalability
                    </div>
                    {scalabilityVerdict ? (
                      <span className={`mt-3 inline-flex rounded-full border px-3 py-1 text-xs ${verdictStyles[scalabilityVerdict]}`}>
                        {scalabilityVerdict}
                      </span>
                    ) : null}
                  </div>
                  <div className="rounded-xl border border-border/70 bg-card p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <Shield className="h-4 w-4" />
                      Security
                    </div>
                    {securityVerdict ? (
                      <span className={`mt-3 inline-flex rounded-full border px-3 py-1 text-xs ${verdictStyles[securityVerdict]}`}>
                        {securityVerdict}
                      </span>
                    ) : null}
                  </div>
                </div>
                {scalabilityVerdict === "REJECTED" || securityVerdict === "REJECTED" ? (
                  <p className="mt-4 text-sm text-muted-foreground">Revising architecture...</p>
                ) : null}
              </div>
            ) : null}
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
                  <span className="text-sm text-foreground">Review pass</span>
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
        </div>
      )}
    </section>
  );
};

export default SessionDashboardPage;

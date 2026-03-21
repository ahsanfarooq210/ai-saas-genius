import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Check,
  FileDown,
  FileText,
  RefreshCw,
  Shield,
  TrendingUp,
  X,
} from "lucide-react";
import { MermaidDiagram } from "@/features/swarm/components/MermaidDiagram";
import { useSwarmStore } from "@/features/swarm/store";
import { SwarmSseClient } from "@/features/swarm/sse";
import { swarmApi } from "@/features/swarm/api";
import { useNavigate, useParams } from "react-router-dom";
import type { AgentState, DocEntry } from "@/features/swarm/types";
import { AgentGraphFlow } from "@/features/swarm/components/AgentGraphFlow";

const agentCardStyles: Record<AgentState, string> = {
  idle: "border-border bg-card",
  active: "border-sky-500/60 bg-sky-500/5 swarm-border-glow",
  approved: "border-emerald-500/60 bg-emerald-500/5",
  rejected: "border-rose-500/60 bg-rose-500/5",
};

const agentDotStyles: Record<AgentState, string> = {
  idle: "bg-muted-foreground/60",
  active: "bg-sky-400 animate-pulse",
  approved: "bg-emerald-500",
  rejected: "bg-destructive",
};

const statusBadgeStyles = {
  APPROVED: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  REJECTED: "border-rose-500/40 bg-rose-500/10 text-rose-300",
};

const SessionDashboardPage = () => {
  const { threadId: routeThreadId } = useParams();
  const navigate = useNavigate();

  const {
    threadId,
    requirement,
    iterationCount,
    maxIterations,
    complexityScore,
    generatedDiagrams,
    generatedDocs,
    debateLog,
    diagramPlan,
    docPlan,
    phaseLabel,
    agentStates,
    sessionStatus,
    connection,
    hitlModalOpen,
    hitlCritiqueOpen,
    architectureJson,
    settings,
    setHitlCritiqueOpen,
    closeHitlModal,
    setSessionStatus,
    completeSession,
    saveSessionHistoryItem,
    hydrateSessionHistory,
    hydrateSessionFromHistory,
    sessionHistory,
  } = useSwarmStore();

  const [activeDiagram, setActiveDiagram] = useState<string>("");
  const [selectedDoc, setSelectedDoc] = useState<DocEntry | null>(null);
  const [humanCritique, setHumanCritique] = useState("");

  const clientRef = useRef<SwarmSseClient | null>(null);
  const debateBottomRef = useRef<HTMLDivElement | null>(null);

  const currentThreadId = routeThreadId ?? threadId;

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
    if (!currentThreadId || sessionStatus === "complete") {
      return;
    }

    if (!clientRef.current) {
      clientRef.current = new SwarmSseClient(currentThreadId);
      clientRef.current.connect();
      setSessionStatus("running");
    }

    return () => {
      clientRef.current?.disconnect();
      clientRef.current = null;
    };
  }, [currentThreadId, sessionStatus, setSessionStatus]);

  useEffect(() => {
    if (!activeDiagram && generatedDiagrams.length > 0) {
      setActiveDiagram(generatedDiagrams[generatedDiagrams.length - 1].diagram_type);
    }
  }, [activeDiagram, generatedDiagrams]);

  useEffect(() => {
    if (!settings.autoScrollDebate) {
      return;
    }
    debateBottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [debateLog.length, settings.autoScrollDebate]);

  useEffect(() => {
    if (sessionStatus === "complete" || sessionStatus === "failed") {
      saveSessionHistoryItem();
    }
  }, [saveSessionHistoryItem, sessionStatus]);

  const progress = useMemo(() => {
    const iterationProgress = maxIterations > 0 ? (iterationCount / maxIterations) * 80 : 0;
    const approvalBoost =
      [agentStates.scalability.state, agentStates.security.state].filter((status) => status === "approved")
        .length *
      10;
    return Math.min(100, Math.max(3, iterationProgress + approvalBoost));
  }, [agentStates.scalability.state, agentStates.security.state, iterationCount, maxIterations]);

  const diagramTypes = useMemo(() => {
    const plan = diagramPlan.length ? diagramPlan : [];
    const generated = generatedDiagrams.map((item) => item.diagram_type);
    return Array.from(new Set([...plan, ...generated]));
  }, [diagramPlan, generatedDiagrams]);

  const activeDiagramEntry = useMemo(
    () => generatedDiagrams.find((entry) => entry.diagram_type === activeDiagram),
    [activeDiagram, generatedDiagrams],
  );

  const componentsCount = useMemo(() => {
    const fromDiagram = generatedDiagrams.reduce(
      (sum, item) => sum + (item.components_count ?? 0),
      0,
    );
    if (fromDiagram > 0) {
      return fromDiagram;
    }
    if (architectureJson && typeof architectureJson === "object") {
      return Object.keys(architectureJson).length;
    }
    return 0;
  }, [architectureJson, generatedDiagrams]);

  const handleManualReconnect = () => {
    if (!clientRef.current && currentThreadId) {
      clientRef.current = new SwarmSseClient(currentThreadId);
    }
    clientRef.current?.reconnectNow();
  };

  const handleApproveExport = () => {
    closeHitlModal();
    completeSession();
    navigate(`/export/${currentThreadId}`);
  };

  const handleSubmitCritique = async () => {
    if (!currentThreadId || !humanCritique.trim()) {
      return;
    }
    await swarmApi.humanFeedback({
      thread_id: currentThreadId,
      critique: humanCritique.trim(),
    });
    setHumanCritique("");
    closeHitlModal();
    setSessionStatus("running");
  };

  return (
    <section className="space-y-4">
      <div className="space-y-2 rounded-xl border border-border/70 bg-card px-4 py-3">
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-sky-500 transition-all duration-200" style={{ width: `${progress}%` }} />
        </div>
        <p className="text-sm text-muted-foreground">{phaseLabel}</p>
      </div>

      {connection.reconnecting ? (
        <div className="flex items-center justify-between rounded-sm border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
          <span>Connection dropped. Reconnecting ({connection.attempts}/10)...</span>
        </div>
      ) : null}

      {connection.permanentlyFailed ? (
        <div className="flex items-center justify-between rounded-sm border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-200">
          <span>Live stream disconnected after 10 retries.</span>
          <button
            onClick={handleManualReconnect}
            className="inline-flex items-center gap-2 rounded-sm border border-rose-400/50 px-3 py-1 text-xs"
          >
            <RefreshCw className="h-3 w-3" />
            Reconnect
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[65%_35%]">
        <div className="space-y-4">
          <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <article className={`rounded-xl border p-3 transition-all duration-200 ${agentCardStyles[agentStates.architect.state]}`}>
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Architect</h3>
                  <p className="text-xs text-muted-foreground">{agentStates.architect.model}</p>
                </div>
                <span className={`mt-1 h-2.5 w-2.5 rounded-full ${agentDotStyles[agentStates.architect.state]}`} />
              </div>
              <p className="mt-2 text-xs text-foreground/90">{agentStates.architect.currentTask || "Idle"}</p>
              <p className="mt-3 text-right font-mono text-[11px] text-muted-foreground">iter {agentStates.architect.lastIteration}</p>
            </article>

            <article className={`rounded-xl border p-3 transition-all duration-200 ${agentCardStyles[agentStates.scalability.state]}`}>
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Scalability Expert</h3>
                  <p className="text-xs text-muted-foreground">{agentStates.scalability.model}</p>
                </div>
                <span className={`mt-1 h-2.5 w-2.5 rounded-full ${agentDotStyles[agentStates.scalability.state]}`} />
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs text-foreground/90">
                {agentStates.scalability.state === "approved" ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : null}
                {agentStates.scalability.state === "rejected" ? <X className="h-3.5 w-3.5 text-rose-300" /> : null}
                <span>{agentStates.scalability.currentTask || agentStates.scalability.state.toUpperCase()}</span>
              </div>
              <p className="mt-3 text-right font-mono text-[11px] text-muted-foreground">iter {agentStates.scalability.lastIteration}</p>
            </article>

            <article className={`rounded-xl border p-3 transition-all duration-200 ${agentCardStyles[agentStates.security.state]}`}>
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Security Auditor</h3>
                  <p className="text-xs text-muted-foreground">{agentStates.security.model}</p>
                </div>
                <span className={`mt-1 h-2.5 w-2.5 rounded-full ${agentDotStyles[agentStates.security.state]}`} />
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs text-foreground/90">
                {agentStates.security.state === "approved" ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : null}
                {agentStates.security.state === "rejected" ? <X className="h-3.5 w-3.5 text-rose-300" /> : null}
                <span>{agentStates.security.currentTask || agentStates.security.state.toUpperCase()}</span>
              </div>
              <p className="mt-3 text-right font-mono text-[11px] text-muted-foreground">iter {agentStates.security.lastIteration}</p>
            </article>
          </section>

          <AgentGraphFlow />

          <section className="rounded-xl border border-border/70 bg-card p-3">
            <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-border pb-3">
              {diagramTypes.map((diagramType) => {
                const isGenerated = generatedDiagrams.some((diagram) => diagram.diagram_type === diagramType);
                const active = activeDiagram === diagramType;
                return (
                  <button
                    key={diagramType}
                    onClick={() => setActiveDiagram(diagramType)}
                    className={`rounded-xl border px-3 py-1.5 text-xs transition-all ${
                      active
                        ? "border-sky-500/60 bg-sky-500/15 text-sky-200"
                        : "border-border bg-background text-foreground/90 hover:border-border/80"
                    }`}
                  >
                    {diagramType}
                    {!isGenerated ? <span className="ml-2 inline-block h-2 w-2 animate-pulse rounded-full bg-muted-foreground/70" /> : null}
                  </button>
                );
              })}
            </div>

            {activeDiagramEntry ? (
              <MermaidDiagram code={activeDiagramEntry.mermaid_code} />
            ) : (
              <div className="flex h-[460px] items-center justify-center rounded-xl border border-dashed border-border bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.05)_1px,transparent_0)] bg-size-[14px_14px] text-muted-foreground">
                Waiting for Architect...
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-5 text-xs text-muted-foreground">
              <span>Complexity score: {complexityScore !== null ? `${complexityScore}/10` : "-"}</span>
              <span>Components: {componentsCount}</span>
              <span>
                Diagrams: {generatedDiagrams.length} of {Math.max(diagramPlan.length, generatedDiagrams.length)} generated
              </span>
            </div>
          </section>
        </div>

        <div className="space-y-4">
          <section className="rounded-xl border border-border/70 bg-card p-3">
            <h3 className="mb-3 text-sm font-semibold text-foreground">Live Debate Log</h3>
            <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
              {debateLog.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border px-3 py-5 text-sm text-muted-foreground">
                  Debate log will appear here as reviewers run.
                </p>
              ) : (
                debateLog.map((entry) => (
                  <article
                    key={entry.id}
                    className="translate-y-2 animate-[swarm-slide-up_180ms_ease-out_forwards] rounded-xl border border-border bg-background p-3 opacity-0"
                  >
                    <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-2 font-medium text-foreground/90">
                        {entry.agent === "scalability" ? <TrendingUp className="h-3.5 w-3.5" /> : <Shield className="h-3.5 w-3.5" />}
                        {entry.agent === "scalability" ? "Scalability Expert" : "Security Auditor"}
                      </span>
                      <span className="font-mono">iter {entry.iteration}</span>
                    </div>
                    <div className="prose prose-invert prose-sm max-w-none [&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.markdown}</ReactMarkdown>
                    </div>
                    <span className={`mt-3 inline-flex rounded-sm border px-2 py-1 text-[10px] font-semibold tracking-[0.08em] ${statusBadgeStyles[entry.status]}`}>
                      {entry.status}
                    </span>
                  </article>
                ))
              )}
              <div ref={debateBottomRef} />
            </div>
          </section>

          <section className="rounded-xl border border-border/70 bg-card p-3">
            <h3 className="mb-3 text-sm font-semibold text-foreground">Generated Documents</h3>
            <div className="space-y-2">
              {docPlan.length > 0
                ? docPlan.map((plannedType, index) => {
                    const doc = generatedDocs[index];
                    if (!doc) {
                      return (
                        <div key={`${plannedType}-${index}`} className="flex items-center justify-between rounded-xl border border-border bg-background px-3 py-2">
                          <div className="space-y-2">
                            <div className="h-3 w-32 animate-pulse rounded bg-muted" />
                            <div className="h-2 w-20 animate-pulse rounded bg-muted/70" />
                          </div>
                          <span className="rounded-sm border border-border px-2 py-0.5 text-[10px] text-muted-foreground">{plannedType}</span>
                        </div>
                      );
                    }
                    return (
                      <button
                        key={doc.title}
                        onClick={() => setSelectedDoc(doc)}
                        className="flex w-full items-center justify-between rounded-xl border border-border bg-background px-3 py-2 text-left transition-colors hover:border-border/80"
                      >
                        <span className="inline-flex items-center gap-2 text-sm text-foreground/90">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          {doc.title}
                        </span>
                        <span className="rounded-sm border border-border px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
                          {doc.doc_type}
                        </span>
                      </button>
                    );
                  })
                : generatedDocs.map((doc) => (
                    <button
                      key={doc.title}
                      onClick={() => setSelectedDoc(doc)}
                      className="flex w-full items-center justify-between rounded-xl border border-border bg-background px-3 py-2 text-left transition-colors hover:border-border/80"
                    >
                      <span className="inline-flex items-center gap-2 text-sm text-foreground/90">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        {doc.title}
                      </span>
                      <span className="rounded-sm border border-border px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
                        {doc.doc_type}
                      </span>
                    </button>
                  ))}
            </div>
          </section>
        </div>
      </div>

      {selectedDoc ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60">
          <aside className="h-full w-full max-w-2xl overflow-y-auto border-l border-border bg-background p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">{selectedDoc.title}</h3>
              <div className="flex items-center gap-2">
                <button
                  className="inline-flex items-center gap-1 rounded-xl border border-border bg-card px-3 py-1.5 text-xs text-foreground/90"
                  onClick={() => {
                    const blob = new Blob([selectedDoc.content], { type: "text/markdown" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${selectedDoc.title}.md`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  <FileDown className="h-3.5 w-3.5" />
                  Download
                </button>
                <button className="rounded-xl border border-border bg-card p-1.5 text-muted-foreground" onClick={() => setSelectedDoc(null)}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="prose prose-invert max-w-none [&_pre]:rounded-sm [&_pre]:bg-muted">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedDoc.content}</ReactMarkdown>
            </div>
          </aside>
        </div>
      ) : null}

      {hitlModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="w-full max-w-2xl rounded-xl border border-border bg-card p-6">
            <h3 className="text-xl font-semibold text-foreground">Swarm Complete — Your Review</h3>
            <div className="mt-3 grid grid-cols-1 gap-2 text-sm text-foreground/90 md:grid-cols-3">
              <div className="rounded-xl border border-border bg-background px-3 py-2">Iterations: {iterationCount}</div>
              <div className="rounded-xl border border-border bg-background px-3 py-2">
                Reviewers approved: {agentStates.scalability.state === "approved" ? 1 : 0} + {agentStates.security.state === "approved" ? 1 : 0}
              </div>
              <div className="rounded-xl border border-border bg-background px-3 py-2">
                Complexity: {complexityScore !== null ? `${complexityScore}/10` : "-"}
              </div>
            </div>

            {!hitlCritiqueOpen ? (
              <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
                <button
                  onClick={handleApproveExport}
                  className="rounded-xl border border-emerald-500/50 bg-emerald-500/20 px-4 py-2.5 font-medium text-emerald-100"
                >
                  Approve & Export
                </button>
                <button
                  onClick={() => setHitlCritiqueOpen(true)}
                  className="rounded-xl border border-amber-500/50 bg-amber-500/20 px-4 py-2.5 font-medium text-amber-100"
                >
                  Request Changes
                </button>
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                <label className="text-sm text-foreground/90">Describe what you want changed or improved</label>
                <textarea
                  value={humanCritique}
                  onChange={(event) => setHumanCritique(event.target.value)}
                  className="h-32 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-amber-400"
                />
                <button
                  onClick={handleSubmitCritique}
                  className="rounded-xl border border-amber-500/50 bg-amber-500/20 px-4 py-2 text-sm text-amber-100"
                >
                  Submit & Resume
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}

      <footer className="text-xs text-muted-foreground">Requirement: “{requirement}”</footer>
    </section>
  );
};

export default SessionDashboardPage;

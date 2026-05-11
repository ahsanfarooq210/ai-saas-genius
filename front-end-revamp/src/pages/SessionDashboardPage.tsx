import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  FileDown,
  FileText,
  Check,
  Shield,
  TrendingUp,
  X,
} from "lucide-react";
import { MermaidDiagram } from "@/features/swarm/components/MermaidDiagram";
import { useSwarmStore } from "@/features/swarm/store";
import { useParams } from "react-router-dom";
import type { DocEntry } from "@/features/swarm/types";
import { AgentGraphFlow } from "@/features/swarm/components/AgentGraphFlow";

const SessionDashboardPage = () => {
  const { threadId: routeThreadId } = useParams();

  const {
    threadId,
    requirement,
    iterationCount,
    complexityScore,
    componentList,
    generatedDiagrams,
    generatedDocs,
    currentArchitectureMermaid,
    diagramPlan,
    docPlan,
    phaseLabel,
    sessionStatus,
    scalabilityFeedback,
    securityFeedback,
    architectureJson,
    saveSessionHistoryItem,
    hydrateSessionHistory,
    hydrateSessionFromHistory,
    sessionHistory,
  } = useSwarmStore();

  const [activeDiagram, setActiveDiagram] = useState<string>("");
  const [selectedDoc, setSelectedDoc] = useState<DocEntry | null>(null);

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
    if (!activeDiagram && generatedDiagrams.length > 0) {
      setActiveDiagram(generatedDiagrams[generatedDiagrams.length - 1].diagram_type);
    }
  }, [activeDiagram, generatedDiagrams]);

  useEffect(() => {
    if (sessionStatus === "complete" || sessionStatus === "failed") {
      saveSessionHistoryItem();
    }
  }, [saveSessionHistoryItem, sessionStatus]);

  const diagramTypes = useMemo(() => {
    const plan = diagramPlan.length ? diagramPlan : [];
    const generated = generatedDiagrams.map((item) => item.diagram_type);
    return Array.from(new Set([...plan, ...generated]));
  }, [diagramPlan, generatedDiagrams]);

  const activeDiagramEntry = useMemo(
    () => generatedDiagrams.find((entry) => entry.diagram_type === activeDiagram),
    [activeDiagram, generatedDiagrams],
  );

  const architectureSource = activeDiagramEntry?.content || currentArchitectureMermaid;
  const allComponents = componentList.length
    ? componentList
    : Array.isArray((architectureJson as { components?: unknown[] })?.components)
      ? (((architectureJson as { components?: unknown[] }).components ?? []) as unknown[]).map((component) =>
          String(component),
        )
      : [];

  const isApproved = useMemo(() => {
    const approvedRegex = /status\s*:\s*approved|approved\b/i;
    return approvedRegex.test(scalabilityFeedback.trim()) && approvedRegex.test(securityFeedback.trim());
  }, [scalabilityFeedback, securityFeedback]);

  return (
    <section className="space-y-4">
      <div className="space-y-2 rounded-xl border border-border/70 bg-card px-4 py-3">
        <p className="text-sm text-muted-foreground">{phaseLabel || "Session loaded."}</p>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span>Thread: {currentThreadId ?? "-"}</span>
          <span>Iterations: {iterationCount}</span>
          <span>Complexity: {complexityScore !== null ? `${complexityScore}/10` : "-"}</span>
          <span>{isApproved ? "Review Status: Approved" : "Review Status: Needs attention"}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[65%_35%]">
        <div className="space-y-4">
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

            {architectureSource ? (
              <MermaidDiagram code={architectureSource} />
            ) : (
              <div className="flex h-[460px] items-center justify-center rounded-xl border border-dashed border-border bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.05)_1px,transparent_0)] bg-size-[14px_14px] text-muted-foreground">
                No Mermaid architecture source found in this session.
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-5 text-xs text-muted-foreground">
              <span>Complexity score: {complexityScore !== null ? `${complexityScore}/10` : "-"}</span>
              <span>Components: {allComponents.length}</span>
              <span>
                Diagrams: {generatedDiagrams.length} of {Math.max(diagramPlan.length, generatedDiagrams.length)} generated
              </span>
            </div>
          </section>

          <section className="rounded-xl border border-border/70 bg-card p-3">
            <h3 className="mb-3 text-sm font-semibold text-foreground">Components</h3>
            {allComponents.length ? (
              <div className="flex flex-wrap gap-2">
                {allComponents.map((component) => (
                  <span
                    key={component}
                    className="rounded-sm border border-border bg-background px-2 py-1 text-xs text-foreground/90"
                  >
                    {component}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No component list returned.</p>
            )}
          </section>
        </div>

        <div className="space-y-4">
          <section className="rounded-xl border border-border/70 bg-card p-3">
            <h3 className="mb-3 text-sm font-semibold text-foreground">Reviewer Feedback</h3>
            <div className="space-y-3">
              <article className="rounded-xl border border-border bg-background p-3">
                <div className="mb-2 inline-flex items-center gap-2 text-xs font-medium text-foreground/90">
                  <TrendingUp className="h-3.5 w-3.5" />
                  Scalability Feedback
                </div>
                <div className="prose prose-invert prose-sm max-w-none [&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {scalabilityFeedback || "No scalability feedback returned."}
                  </ReactMarkdown>
                </div>
              </article>
              <article className="rounded-xl border border-border bg-background p-3">
                <div className="mb-2 inline-flex items-center gap-2 text-xs font-medium text-foreground/90">
                  <Shield className="h-3.5 w-3.5" />
                  Security Feedback
                </div>
                <div className="prose prose-invert prose-sm max-w-none [&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {securityFeedback || "No security feedback returned."}
                  </ReactMarkdown>
                </div>
              </article>
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
                    </button>
                  ))}
            </div>
          </section>

          <section className="rounded-xl border border-border/70 bg-card p-3">
            <h3 className="mb-2 text-sm font-semibold text-foreground">Completion</h3>
            <div
              className={`inline-flex items-center gap-2 rounded-sm border px-2 py-1 text-xs ${
                isApproved
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-300"
              }`}
            >
              {isApproved ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
              {isApproved
                ? "Both reviewers approved this session."
                : "At least one reviewer did not return approved status."}
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
                {selectedDoc.url && (
                  <a
                    href={selectedDoc.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-xl border border-border bg-card px-3 py-1.5 text-xs text-foreground/90 hover:bg-muted"
                  >
                    Open Uploaded File
                  </a>
                )}
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

      <footer className="text-xs text-muted-foreground">Requirement: “{requirement}”</footer>
    </section>
  );
};

export default SessionDashboardPage;

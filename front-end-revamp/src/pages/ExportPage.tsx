import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, Download, FileText, GitBranch } from "lucide-react";
import { useSwarmStore } from "@/features/swarm/store";

const triggerDownload = (filename: string, content: string, type: string) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

const ExportPage = () => {
  const navigate = useNavigate();
  const requirement = useSwarmStore((state) => state.requirement);
  const generatedDocs = useSwarmStore((state) => state.generatedDocs);
  const generatedDiagrams = useSwarmStore((state) => state.generatedDiagrams);
  const complexityScore = useSwarmStore((state) => state.complexityScore);

  const manifest = useMemo(
    () =>
      JSON.stringify(
        {
          requirement,
          complexity_score: complexityScore,
          diagrams: generatedDiagrams.map((item) => ({
            type: item.diagram_type,
            path: item.path ?? null,
            status: item.status,
          })),
          docs: generatedDocs.map((item) => ({
            slug: item.doc_slug,
            title: item.title ?? null,
            path: item.path ?? null,
            status: item.status,
          })),
        },
        null,
        2,
      ),
    [complexityScore, generatedDiagrams, generatedDocs, requirement],
  );

  return (
    <section className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Export Session Manifest</h1>
        <blockquote className="rounded-xl border border-border/70 bg-card px-4 py-3 text-foreground/90">
          “{requirement || "No requirement recorded"}”
        </blockquote>
        <p className="text-sm text-muted-foreground">
          This frontend only receives storage paths from the swarm stream. Raw Markdown and Mermaid content are not fetched here.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <article className="rounded-xl border border-border/70 bg-card p-4">
          <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-background">
            <Download className="h-4 w-4" />
          </div>
          <h2 className="text-sm font-semibold text-foreground">Session Manifest</h2>
          <p className="mt-1 text-xs text-muted-foreground">Requirement, complexity score, and final artifact paths.</p>
          <button
            type="button"
            onClick={() => triggerDownload("swarm-session-manifest.json", manifest, "application/json")}
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-1.5 text-xs text-foreground"
          >
            <Download className="h-3.5 w-3.5" />
            Download JSON
          </button>
        </article>

        <article className="rounded-xl border border-border/70 bg-card p-4">
          <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-background">
            <Copy className="h-4 w-4" />
          </div>
          <h2 className="text-sm font-semibold text-foreground">Copy All Paths</h2>
          <p className="mt-1 text-xs text-muted-foreground">Copies every final doc and diagram storage key to the clipboard.</p>
          <button
            type="button"
            onClick={async () => {
              const text = [
                ...generatedDiagrams.map((item) => item.path).filter(Boolean),
                ...generatedDocs.map((item) => item.path).filter(Boolean),
              ].join("\n");
              await navigator.clipboard.writeText(text);
            }}
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-1.5 text-xs text-foreground"
          >
            <Copy className="h-3.5 w-3.5" />
            Copy
          </button>
        </article>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border border-border/70 bg-card p-4">
          <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-background">
            <GitBranch className="h-4 w-4" />
          </div>
          <h2 className="text-sm font-semibold text-foreground">Diagrams</h2>
          <div className="mt-3 space-y-2">
            {generatedDiagrams.map((diagram) => (
              <div key={diagram.diagram_type} className="rounded-xl border border-border bg-background px-3 py-2">
                <p className="text-sm text-foreground">{diagram.diagram_type}</p>
                <p className="truncate text-xs text-muted-foreground">{diagram.path ?? "No path available"}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-border/70 bg-card p-4">
          <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-background">
            <FileText className="h-4 w-4" />
          </div>
          <h2 className="text-sm font-semibold text-foreground">Documents</h2>
          <div className="mt-3 space-y-2">
            {generatedDocs.map((doc) => (
              <div key={doc.doc_slug} className="rounded-xl border border-border bg-background px-3 py-2">
                <p className="text-sm text-foreground">{doc.title ?? doc.doc_slug}</p>
                <p className="truncate text-xs text-muted-foreground">{doc.path ?? "No path available"}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      <button
        type="button"
        onClick={() => navigate("/swarm")}
        className="rounded-xl border border-primary bg-primary px-4 py-2 text-sm text-primary-foreground"
      >
        Start New Session
      </button>
    </section>
  );
};

export default ExportPage;

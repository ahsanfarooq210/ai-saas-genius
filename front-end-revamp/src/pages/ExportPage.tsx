import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Braces, Download, FileArchive, FileText } from "lucide-react";
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
  const { threadId } = useParams();
  const requirement = useSwarmStore((state) => state.requirement);
  const generatedDocs = useSwarmStore((state) => state.generatedDocs);
  const generatedDiagrams = useSwarmStore((state) => state.generatedDiagrams);
  const architectureJson = useSwarmStore((state) => state.architectureJson);

  const fullReport = useMemo(
    () => generatedDocs.map((doc) => `# ${doc.title}\n\n${doc.content}`).join("\n\n---\n\n"),
    [generatedDocs],
  );

  const estimatedSizeKb = useMemo(
    () => Math.max(1, Math.round(new Blob([fullReport]).size / 1024)),
    [fullReport],
  );

  const diagramsBundle = useMemo(
    () =>
      generatedDiagrams
        .map((diagram) => `## ${diagram.diagram_type}\n\n\
\
${diagram.mermaid_code}\n\
\
`)
        .join("\n"),
    [generatedDiagrams],
  );

  const shareLink = `${window.location.origin}/session/${threadId}`;

  return (
    <section className="mx-auto max-w-6xl space-y-6">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Your Architecture is Ready</h1>
        <blockquote className="rounded-xl border border-border/70 bg-card px-4 py-3 text-foreground/90">
          “{requirement || "No requirement recorded"}”
        </blockquote>
      </header>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <article className="rounded-xl border border-border/70 bg-card p-4">
          <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-background">
            <FileText className="h-4 w-4" />
          </div>
          <h3 className="text-sm font-semibold text-foreground">Full Architecture Report</h3>
          <p className="mt-1 text-xs text-muted-foreground">Estimated size: {estimatedSizeKb}KB</p>
          <button
            onClick={() => triggerDownload("architecture-report.md", fullReport, "text/markdown")}
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-1.5 text-xs text-foreground"
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </button>
        </article>

        <article className="rounded-xl border border-border/70 bg-card p-4">
          <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-background">
            <FileArchive className="h-4 w-4" />
          </div>
          <h3 className="text-sm font-semibold text-foreground">Mermaid Diagrams Bundle</h3>
          <p className="mt-1 text-xs text-muted-foreground">{generatedDiagrams.length} diagrams</p>
          <button
            onClick={() => triggerDownload("diagrams-bundle.mmd", diagramsBundle, "text/plain")}
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-1.5 text-xs text-foreground"
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </button>
        </article>

        <article className="rounded-xl border border-border/70 bg-card p-4">
          <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-background">
            <Braces className="h-4 w-4" />
          </div>
          <h3 className="text-sm font-semibold text-foreground">Architecture JSON</h3>
          <p className="mt-1 text-xs text-muted-foreground">Structured architecture export</p>
          <button
            onClick={() =>
              triggerDownload(
                "architecture.json",
                JSON.stringify(architectureJson ?? {}, null, 2),
                "application/json",
              )
            }
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-1.5 text-xs text-foreground"
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </button>
        </article>

        {generatedDocs.map((doc) => (
          <article key={doc.title} className="rounded-xl border border-border/70 bg-card p-4">
            <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-background">
              <FileText className="h-4 w-4" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">{doc.title}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{doc.doc_type}</p>
            <button
              onClick={() => triggerDownload(`${doc.title}.md`, doc.content, "text/markdown")}
              className="mt-4 inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-1.5 text-xs text-foreground"
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </button>
          </article>
        ))}
      </div>

      <section className="rounded-xl border border-border/70 bg-card px-4 py-3">
        <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Share Session</p>
        <div className="mt-2 flex flex-col gap-2 md:flex-row md:items-center">
          <input
            readOnly
            value={shareLink}
            className="h-9 flex-1 rounded-xl border border-border bg-background px-3 text-sm text-foreground/90"
          />
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(shareLink);
            }}
            className="h-9 rounded-xl border border-border bg-background px-3 text-sm text-foreground"
          >
            Copy
          </button>
        </div>
      </section>

      <button
        onClick={() => navigate("/")}
        className="rounded-xl border border-primary bg-primary px-4 py-2 text-sm text-primary-foreground"
      >
        Start New Session
      </button>
    </section>
  );
};

export default ExportPage;

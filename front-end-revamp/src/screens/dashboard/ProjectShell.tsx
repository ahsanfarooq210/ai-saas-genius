import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowsClockwise,
  Copy,
  Plus,
  Stop,
  WarningCircle,
} from "@phosphor-icons/react";
import { Link, useParams } from "react-router-dom";

import { projectTabs, type ProjectTab } from "@/data/dashboard-demo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useProjectWorkspace } from "@/features/projects/project-workspace-context";
import { DashboardShell } from "@/screens/dashboard/DashboardShell";

interface ProjectShellProps {
  readonly activeTab: ProjectTab;
  readonly children: ReactNode;
}
const suggestions = [
  "Replace the in-memory cache with Redis.",
  "Add multi-region disaster recovery.",
  "Use PostgreSQL instead of MongoDB.",
];
const phaseLabels = {
  supervisor: "Planning next step",
  architecture: "Revising architecture",
  diagram: "Generating diagrams",
  documentation: "Writing documentation",
  review: "Reviewing architecture",
  unknown: "Working",
};

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function ProjectShell({ activeTab, children }: ProjectShellProps) {
  const { threadId = "" } = useParams();
  const projectPath = `/dashboard/projects/${threadId}`;
  const workspace = useProjectWorkspace();
  const [instruction, setInstruction] = useState("");
  const [validation, setValidation] = useState<string | null>(null);
  const revisionAtSubmit = useRef<number | null>(null);
  const model = workspace.visibleWorkspace;

  useEffect(() => {
    if (
      revisionAtSubmit.current !== null &&
      workspace.currentRevision > revisionAtSubmit.current
    ) {
      setInstruction("");
      revisionAtSubmit.current = null;
    }
  }, [workspace.currentRevision]);

  if (workspace.isLoading && !model)
    return (
      <DashboardShell>
        <div className="flex min-h-[50vh] items-center justify-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          Loading architecture workspace…
        </div>
      </DashboardShell>
    );
  if (workspace.unavailable || (!model && workspace.streamError))
    return (
      <DashboardShell>
        <div className="mx-auto max-w-xl py-16">
          <Card>
            <CardHeader>
              <WarningCircle className="size-6 text-destructive" />
              <CardTitle>Project unavailable</CardTitle>
              <CardDescription>
                {workspace.streamError ??
                  "This thread does not exist on the backend."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Link to="/dashboard/projects">
                <Button variant="outline">All projects</Button>
              </Link>
              <Link to="/dashboard/new">
                <Button>New architecture</Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </DashboardShell>
    );
  if (!model) return null;

  const submit = () => {
    const value = instruction.trim();
    if (!value) {
      setValidation("Describe what you want changed in this architecture.");
      return;
    }
    setValidation(null);
    revisionAtSubmit.current = workspace.currentRevision;
    workspace.submitRevision(value);
  };

  return (
    <DashboardShell>
      <div className="space-y-6">
        <Link
          to="/dashboard/projects"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> All projects
        </Link>
        <section className="border border-border bg-card p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge variant="outline">
                  {workspace.session?.status ?? model.status}
                </Badge>
                <Badge variant="secondary">
                  Revision {model.revisionNumber}
                </Badge>
                {workspace.viewedRevision && (
                  <Badge
                    variant="outline"
                    className="border-amber-500/40 text-amber-700 dark:text-amber-300"
                  >
                    Viewing history
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  Completed {formatDate(model.completedAt)}
                </span>
              </div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                {workspace.localTitle}
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                {model.requirement}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <code className="max-w-64 truncate border border-border bg-muted px-2 py-1 font-mono text-[10px]">
                  {threadId}
                </code>
                <Button
                  size="xs"
                  variant="ghost"
                  aria-label="Copy thread ID"
                  onClick={() => void navigator.clipboard.writeText(threadId)}
                >
                  <Copy />
                  Copy ID
                </Button>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => void workspace.refresh()}
                disabled={workspace.isLoading}
              >
                <ArrowsClockwise />
                Refresh
              </Button>
              <Link to="/dashboard/new">
                <Button>
                  <Plus />
                  New architecture
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {(workspace.session?.status === "failed" ||
          workspace.selectedFailedRevision) && (
          <div
            role="alert"
            className="border border-destructive/40 bg-destructive/5 p-4 text-sm"
          >
            <p className="font-medium">
              Revision attempt failed and was not promoted
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {workspace.selectedFailedRevision?.instruction ??
                workspace.streamError ??
                "The latest successful architecture remains visible."}
            </p>
            {workspace.selectedFailedRevision && (
              <Button
                className="mt-3"
                size="sm"
                variant="outline"
                onClick={workspace.returnToCurrent}
              >
                Return to current revision
              </Button>
            )}
          </div>
        )}
        {workspace.viewedRevision && (
          <div className="flex items-center justify-between border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
            <span>
              Viewing revision {workspace.viewedRevision.revisionNumber} in
              read-only mode.
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={workspace.returnToCurrent}
            >
              Return to current revision
            </Button>
          </div>
        )}

        <nav
          className="flex gap-1 overflow-x-auto border-b border-border pb-1"
          aria-label="Project workspace"
        >
          {projectTabs.map((tab) => (
            <Link
              key={tab.value}
              to={`${projectPath}/${tab.value}`}
              className={
                activeTab === tab.value
                  ? "border-b-2 border-foreground px-3 py-2 text-xs font-medium text-foreground"
                  : "border-b-2 border-transparent px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
              }
            >
              {tab.label}
            </Link>
          ))}
        </nav>
        {children}

        {(workspace.isSubmittingRevision ||
          workspace.streamEvents.length > 0 ||
          workspace.streamError) && (
          <Card aria-live="polite">
            <CardHeader className="border-b border-border">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>
                    {workspace.isSubmittingRevision
                      ? phaseLabels[
                          workspace.streamEvents.at(-1)?.phase ?? "unknown"
                        ]
                      : "Latest execution"}
                  </CardTitle>
                  <CardDescription>
                    {workspace.streamEvents.at(-1)?.message ??
                      workspace.streamError ??
                      workspace.streamStatus}
                  </CardDescription>
                </div>
                {workspace.isSubmittingRevision && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={workspace.cancelOperation}
                  >
                    <Stop />
                    Cancel listening
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <ol className="max-h-52 space-y-2 overflow-y-auto text-xs">
                {workspace.streamEvents.map((event, index) => (
                  <li
                    key={`${event.node}-${index}`}
                    className="grid grid-cols-[7rem_1fr] gap-2"
                  >
                    <span className="font-medium capitalize">
                      {event.phase}
                    </span>
                    <span className="text-muted-foreground">
                      {event.message}
                    </span>
                  </li>
                ))}
              </ol>
              {workspace.streamError && (
                <p className="text-xs text-destructive">
                  {workspace.streamError}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <Card className="sticky bottom-3 z-10 shadow-lg">
          <CardHeader className="border-b border-border">
            <CardTitle>Revise this architecture</CardTitle>
            <CardDescription>
              Follow-ups always modify revision {workspace.currentRevision}, the
              latest successful backend version.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            <Textarea
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter")
                  submit();
              }}
              disabled={
                workspace.isSubmittingRevision ||
                Boolean(workspace.viewedRevision) ||
                Boolean(workspace.selectedFailedRevision)
              }
              placeholder="Describe what you want changed in this architecture…"
              className="min-h-24"
            />
            {validation && (
              <p role="alert" className="text-xs text-destructive">
                {validation}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={
                    workspace.isSubmittingRevision ||
                    Boolean(workspace.viewedRevision)
                  }
                  onClick={() => setInstruction(suggestion)}
                  className="border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-muted-foreground">
                Press Ctrl/⌘ + Enter to submit.
              </p>
              <Button
                onClick={submit}
                disabled={
                  workspace.isSubmittingRevision ||
                  Boolean(workspace.viewedRevision) ||
                  Boolean(workspace.selectedFailedRevision)
                }
              >
                {workspace.isSubmittingRevision ? (
                  <Spinner />
                ) : (
                  <ArrowsClockwise />
                )}
                Submit revision
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardShell>
  );
}

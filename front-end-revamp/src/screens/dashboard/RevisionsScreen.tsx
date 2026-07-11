import { CheckCircle, Clock, WarningCircle } from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useProjectWorkspace } from "@/features/projects/project-workspace-context";
import { ProjectShell } from "@/screens/dashboard/ProjectShell";

const icons = { done: CheckCircle, running: Clock, failed: WarningCircle };
const date = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "—";

export function RevisionsScreen() {
  const workspace = useProjectWorkspace();
  return (
    <ProjectShell activeTab="revisions">
      <Card>
        <CardHeader className="border-b border-border">
          <CardTitle>Revision history</CardTitle>
          <CardDescription>
            The current badge follows the latest successful backend revision,
            not the highest attempted number.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pt-5">
          {workspace.revisions.map((revision) => {
            const Icon = icons[revision.status];
            const isCurrent =
              revision.revision_number === workspace.currentRevision;
            return (
              <button
                type="button"
                key={revision.revision_number}
                onClick={() => void workspace.viewRevision(revision)}
                className="grid w-full gap-3 border border-border p-4 text-left transition-colors hover:bg-muted/40 sm:grid-cols-[auto_1fr_auto]"
              >
                <Icon className="mt-0.5 size-5 text-primary" />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">
                      Revision {revision.revision_number}
                    </p>
                    <Badge variant="outline">
                      {revision.status.toUpperCase()}
                    </Badge>
                    {isCurrent && <Badge>Current</Badge>}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    {revision.instruction}
                  </p>
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    Created {date(revision.created_at)} · Completed{" "}
                    {date(revision.completed_at)}
                  </p>
                </div>
                <span className="text-xs text-primary">
                  {revision.status === "done" && !isCurrent
                    ? "View revision"
                    : revision.status === "failed"
                      ? "View failure"
                      : isCurrent
                        ? "Current workspace"
                        : "In progress"}
                </span>
              </button>
            );
          })}
          {workspace.isLoadingHistory && (
            <p className="text-xs text-muted-foreground">
              Loading revision history…
            </p>
          )}
          {!workspace.isLoadingHistory && workspace.revisions.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No revision history is available.
            </p>
          )}
          {(workspace.viewedRevision || workspace.selectedFailedRevision) && (
            <Button variant="outline" onClick={workspace.returnToCurrent}>
              Return to current revision
            </Button>
          )}
        </CardContent>
      </Card>
    </ProjectShell>
  );
}

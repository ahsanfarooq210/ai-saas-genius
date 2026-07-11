import { ShieldCheck, TrendUp } from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useProjectWorkspace } from "@/features/projects/project-workspace-context";
import { ProjectShell } from "@/screens/dashboard/ProjectShell";

function verdict(feedback: string): string {
  const upper = feedback.toUpperCase();
  if (upper.includes("REJECTED")) return "REJECTED";
  if (upper.includes("APPROVED")) return "APPROVED";
  return "REVIEW";
}

export function ReviewsScreen() {
  const { visibleWorkspace: workspace } = useProjectWorkspace();
  if (!workspace) return null;
  const reviews = [
    ["Scalability review", TrendUp, workspace.scalabilityFeedback],
    ["Security review", ShieldCheck, workspace.securityFeedback],
  ] as const;
  return (
    <ProjectShell activeTab="reviews">
      <div className="space-y-5">
        <section>
          <h2 className="text-xl font-semibold">Design reviews</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Final reviewer feedback attached to revision{" "}
            {workspace.revisionNumber}.
          </p>
        </section>
        <div className="grid gap-5 lg:grid-cols-2">
          {reviews.map(([title, Icon, feedback]) => (
            <Card key={title}>
              <CardHeader className="border-b border-border">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Icon className="size-5 text-primary" />
                    <CardTitle className="mt-3">{title}</CardTitle>
                    <CardDescription>Final review verdict</CardDescription>
                  </div>
                  <Badge variant="outline">{verdict(feedback)}</Badge>
                </div>
              </CardHeader>
              <CardContent className="whitespace-pre-wrap pt-5 text-sm leading-7 text-muted-foreground">
                {feedback || "No feedback available."}
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle>Reviewer debate</CardTitle>
            <CardDescription>
              Chronological reviewer feedback and iteration status.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-5">
            {workspace.debateLogs.map((log, index) => (
              <div
                key={`${log.agent}-${log.iteration}-${index}`}
                className="border-l-2 border-primary/50 pl-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-medium">{log.agent}</p>
                  <Badge variant="outline">{log.status || "UNKNOWN"}</Badge>
                  <span className="text-[10px] text-muted-foreground">
                    Iteration {log.iteration}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                  {log.feedback}
                </p>
              </div>
            ))}
            {workspace.debateLogs.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No debate logs are available.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </ProjectShell>
  );
}

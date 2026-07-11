import {
  ArrowRight,
  ClockCounterClockwise,
  Plus,
  Trash,
} from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  listRecentProjects,
  removeRecentProject,
} from "@/features/projects/project-storage";
import { DashboardShell } from "@/screens/dashboard/DashboardShell";

export function ProjectsScreen() {
  const projects = listRecentProjects();
  return (
    <DashboardShell>
      <div className="space-y-6 py-3">
        <section className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-primary">
              Architecture workspace
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              Projects
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Recent projects are lightweight references stored in this browser
              and verified when opened.
            </p>
          </div>
          <Link to="/dashboard/projects/new">
            <Button>
              <Plus />
              New project
            </Button>
          </Link>
        </section>
        {projects.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <Card key={project.threadId} className="h-full">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle>
                        {project.localTitle ||
                          project.requirement ||
                          "Architecture project"}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        Opened {new Date(project.lastOpenedAt).toLocaleString()}
                      </CardDescription>
                    </div>
                    <Badge variant="outline">
                      {project.unavailable
                        ? "Unavailable"
                        : project.currentRevision
                          ? `Revision ${project.currentRevision}`
                          : "Pending"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex items-center justify-between border-t border-border pt-4">
                  <Link
                    to={`/dashboard/projects/${project.threadId}/overview`}
                    className="flex min-w-0 items-center gap-2"
                  >
                    <span className="flex min-w-0 items-center gap-1.5 truncate font-mono text-[10px] text-muted-foreground">
                      <ClockCounterClockwise className="size-3 shrink-0" />
                      {project.threadId}
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-primary" />
                  </Link>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remove ${project.localTitle || project.threadId}`}
                    onClick={() => {
                      removeRecentProject(project.threadId);
                      window.location.reload();
                    }}
                  >
                    <Trash />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>No projects yet</CardTitle>
              <CardDescription>
                Create an architecture to save its thread reference here.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link to="/dashboard/new">
                <Button>Design a system</Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardShell>
  );
}

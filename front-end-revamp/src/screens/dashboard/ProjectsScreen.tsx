import { ArrowRight, ArrowsClockwise, Plus } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listSwarmSessions, type SwarmSessionSummary } from "@/api/swarm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listRecentProjects } from "@/features/projects/project-storage";
import { getErrorMessage } from "@/lib/api-error";
import { DashboardShell } from "@/screens/dashboard/DashboardShell";

export function ProjectsScreen() {
  const [projects, setProjects] = useState<SwarmSessionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const recentProjects = listRecentProjects();

  const loadProjects = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await listSwarmSessions();
      setProjects(response.sessions);
    } catch (loadError) {
      setError(getErrorMessage(loadError, "Could not load your projects."));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(loadProjects);
  }, [loadProjects]);

  const localTitle = (threadId: string) =>
    recentProjects.find((project) => project.threadId === threadId)?.localTitle;

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
              All architecture projects saved to your account.
            </p>
          </div>
          <Link to="/dashboard/projects/new">
            <Button>
              <Plus />
              New project
            </Button>
          </Link>
        </section>
        {isLoading ? (
          <Card>
            <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <ArrowsClockwise className="size-4 animate-spin" />
              Loading projects…
            </CardContent>
          </Card>
        ) : error ? (
          <Card>
            <CardHeader>
              <CardTitle>Could not load projects</CardTitle>
              <CardDescription>{error}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" onClick={() => void loadProjects()}>
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : projects.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <Card key={project.thread_id} className="h-full">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle>
                        {localTitle(project.thread_id) ||
                          project.requirement ||
                          "Architecture project"}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        Created{" "}
                        {project.created_at
                          ? new Date(project.created_at).toLocaleString()
                          : "—"}
                      </CardDescription>
                    </div>
                    <Badge variant="outline">
                      {project.revision_number
                        ? `Revision ${project.revision_number}`
                        : "Pending"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex items-center justify-between border-t border-border pt-4">
                  <Link
                    to={`/dashboard/projects/${project.thread_id}/overview`}
                    className="flex min-w-0 items-center gap-2"
                  >
                    <span className="flex min-w-0 items-center gap-1.5 truncate font-mono text-[10px] text-muted-foreground">
                      {project.thread_id}
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-primary" />
                  </Link>
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

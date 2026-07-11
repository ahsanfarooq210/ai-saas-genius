import { useRef, useState } from "react";
import {
  Lightning,
  Play,
  ShieldCheck,
  SquaresFour,
  Stop,
} from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";

import {
  getSwarmSession,
  listSwarmRevisions,
  streamSwarmRun,
  type SwarmProgressEvent,
} from "@/api/swarm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createThreadId,
  saveRecentProject,
} from "@/features/projects/project-storage";
import { DashboardShell } from "@/screens/dashboard/DashboardShell";

export function NewArchitectureScreen() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [requirement, setRequirement] = useState("");
  const [events, setEvents] = useState<SwarmProgressEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const controller = useRef<AbortController | null>(null);

  const start = () => {
    const taskRequirement = requirement.trim();
    if (!taskRequirement || isRunning) {
      if (!taskRequirement) setError("Describe the system you want to design.");
      return;
    }
    const threadId = createThreadId();
    saveRecentProject({
      threadId,
      localTitle: title.trim() || undefined,
      requirement: taskRequirement,
      lastOpenedAt: new Date().toISOString(),
    });
    setError(null);
    setEvents([]);
    setIsRunning(true);
    controller.current = streamSwarmRun(
      { task_requirement: taskRequirement, thread_id: threadId },
      {
        onProgress: (event) =>
          event.thread_id === threadId &&
          setEvents((items) => [...items, event]),
        onDone: (event) => {
          if (event.thread_id !== threadId) return;
          void Promise.all([
            getSwarmSession(threadId),
            listSwarmRevisions(threadId),
          ])
            .then(([session]) => {
              saveRecentProject({
                threadId,
                localTitle: title.trim() || undefined,
                requirement: session.requirement,
                currentRevision: session.revision_number,
                lastOpenedAt: new Date().toISOString(),
                lastCompletedAt:
                  session.completed_at ?? new Date().toISOString(),
              });
              navigate(`/dashboard/projects/${threadId}/overview`);
            })
            .catch(() =>
              setError(
                "Generation finished, but the completed workspace could not be loaded. Open the project from Recent projects to retry.",
              ),
            )
            .finally(() => setIsRunning(false));
        },
        onError: (event) => {
          if (event.thread_id === threadId) {
            setError(event.message);
            setIsRunning(false);
          }
        },
      },
    );
  };

  return (
    <DashboardShell>
      <div className="mx-auto max-w-5xl space-y-6 py-3">
        <section>
          <Badge
            variant="outline"
            className="gap-1 border-primary/30 bg-primary/10 text-primary"
          >
            <Lightning weight="fill" />
            New architecture
          </Badge>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">
            Design your system
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Start with the product, users, scale, integrations, and constraints.
            The workspace will shape the rest into a durable project.
          </p>
        </section>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <Card>
            <CardHeader className="border-b border-border">
              <CardTitle>What are you building?</CardTitle>
              <CardDescription>
                A project thread is saved before generation begins, so you can
                recover it later.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-5">
              <label className="space-y-2 text-xs font-medium">
                Project title{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  disabled={isRunning}
                  placeholder="URL shortener"
                />
              </label>
              <Textarea
                value={requirement}
                onChange={(event) => setRequirement(event.target.value)}
                disabled={isRunning}
                placeholder="Describe the product, users, scale, integrations, constraints, and non-functional requirements…"
                className="min-h-52 resize-none p-4 text-sm leading-6"
              />
              {error && (
                <p role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              )}
              <div className="flex items-center justify-between border-t border-border pt-4">
                <p
                  className="max-w-sm text-xs leading-5 text-muted-foreground"
                  aria-live="polite"
                >
                  {isRunning
                    ? (events.at(-1)?.message ??
                      "Connecting to the architecture team…")
                    : "A new thread creates revision 1."}
                </p>
                {isRunning ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      controller.current?.abort();
                      setIsRunning(false);
                      setError(
                        "Listening stopped. The backend may still be running; open the saved project to inspect it.",
                      );
                    }}
                  >
                    <Stop />
                    Cancel
                  </Button>
                ) : (
                  <Button onClick={start}>
                    <Play weight="fill" />
                    Generate architecture
                  </Button>
                )}
              </div>
              {events.length > 0 && (
                <ol className="max-h-48 space-y-2 overflow-y-auto border border-border bg-muted/30 p-3 text-xs">
                  {events.map((event, index) => (
                    <li key={`${event.node}-${index}`}>
                      <span className="font-medium">{event.phase}</span> ·{" "}
                      {event.message}
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">What you will receive</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  [SquaresFour, "System diagrams"],
                  [ShieldCheck, "Security review"],
                  [Lightning, "Scalability review"],
                ].map(([Icon, label]) => {
                  const ItemIcon = Icon as typeof SquaresFour;
                  return (
                    <div
                      key={label as string}
                      className="flex items-center gap-3"
                    >
                      <div className="flex size-8 items-center justify-center border border-border bg-muted">
                        <ItemIcon className="size-4 text-primary" />
                      </div>
                      <span className="text-xs font-medium">
                        {label as string}
                      </span>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}

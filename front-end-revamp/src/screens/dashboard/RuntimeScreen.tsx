import { useEffect, useState } from "react";
import { Cpu } from "@phosphor-icons/react";
import { getSwarmState, type SwarmCheckpointResponse } from "@/api/swarm";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useProjectWorkspace } from "@/features/projects/project-workspace-context";
import { getErrorMessage } from "@/lib/api-error";
import { ProjectShell } from "@/screens/dashboard/ProjectShell";

export function RuntimeScreen() {
  const { currentWorkspace } = useProjectWorkspace();
  const [checkpoint, setCheckpoint] = useState<SwarmCheckpointResponse | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!currentWorkspace) return;
    const controller = new AbortController();
    void getSwarmState(currentWorkspace.threadId, { signal: controller.signal })
      .then(setCheckpoint)
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(getErrorMessage(reason, "Could not load checkpoint state."));
      });
    return () => controller.abort();
  }, [currentWorkspace]);
  return (
    <ProjectShell activeTab="runtime">
      <div className="space-y-5">
        <section>
          <Badge variant="outline" className="gap-1">
            <Cpu />
            Advanced view
          </Badge>
          <h2 className="mt-3 text-xl font-semibold">Runtime checkpoint</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Recovery and graph diagnostics. The completed workspace still comes
            from the session endpoint.
          </p>
        </section>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {checkpoint ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Revision", checkpoint.revision_number],
                ["Iteration", checkpoint.iteration_count],
                ["Diagrams", checkpoint.generated_diagram_count],
                ["Documents", checkpoint.generated_doc_count],
              ].map(([label, value]) => (
                <div key={label} className="border border-border bg-card p-4">
                  <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    {label}
                  </p>
                  <p className="mt-1 text-lg font-semibold">{value}</p>
                </div>
              ))}
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Checkpoint summary</CardTitle>
                <CardDescription>
                  Pending graph nodes and final persisted signals
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-xs text-muted-foreground">
                <p className="flex justify-between">
                  <span>Next nodes</span>
                  <span className="font-mono text-foreground">
                    {JSON.stringify(checkpoint.next)}
                  </span>
                </p>
                <p className="flex justify-between">
                  <span>Next agent</span>
                  <span className="text-foreground">
                    {checkpoint.next_agent || "—"}
                  </span>
                </p>
                <p className="flex justify-between">
                  <span>Docs complete</span>
                  <span>{checkpoint.docs_complete ? "Yes" : "No"}</span>
                </p>
                <p className="flex justify-between">
                  <span>Debate logs</span>
                  <span>{checkpoint.debate_log_count}</span>
                </p>
              </CardContent>
            </Card>
          </>
        ) : (
          !error && (
            <p className="text-sm text-muted-foreground">Loading checkpoint…</p>
          )
        )}
      </div>
    </ProjectShell>
  );
}

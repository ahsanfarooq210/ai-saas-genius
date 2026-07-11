import { ArrowBendDownRight, Code, GitBranch } from "@phosphor-icons/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useProjectWorkspace } from "@/features/projects/project-workspace-context";
import { ProjectShell } from "@/screens/dashboard/ProjectShell";

export function ArchitectureScreen() {
  const { visibleWorkspace: workspace } = useProjectWorkspace();
  if (!workspace) return null;
  return (
    <ProjectShell activeTab="architecture">
      <div className="space-y-5">
        <section>
          <h2 className="text-xl font-semibold">Component map</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Persisted system boundaries and relationships for revision{" "}
            {workspace.revisionNumber}.
          </p>
        </section>
        <div className="grid gap-4 md:grid-cols-2">
          {Object.entries(workspace.architectureJson).map(
            ([name, component]) => (
              <Card key={name}>
                <CardHeader>
                  <GitBranch className="size-5 text-primary" />
                  <CardTitle className="mt-3">{name}</CardTitle>
                  <CardDescription>
                    {component.description || "No description provided."}
                  </CardDescription>
                </CardHeader>
                <CardContent className="border-t border-border pt-4">
                  <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    Relationships
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {(component.relations ?? []).length ? (
                      component.relations?.map((relation) => (
                        <span
                          key={relation}
                          className="inline-flex items-center gap-1 border border-border bg-muted px-2 py-1 text-[10px] text-muted-foreground"
                        >
                          <ArrowBendDownRight className="size-3" />
                          {relation}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        None listed
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ),
          )}
        </div>
        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2">
              <Code />
              Raw architecture JSON
            </CardTitle>
            <CardDescription>
              Canonical structured architecture for this revision.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-5">
            <pre className="overflow-auto bg-muted/40 p-4 font-mono text-xs leading-6 text-muted-foreground">
              {JSON.stringify(workspace.architectureJson, null, 2)}
            </pre>
          </CardContent>
        </Card>
      </div>
    </ProjectShell>
  );
}

import { ArrowSquareOut } from "@phosphor-icons/react";
import { ArtifactContent } from "@/components/workspace/ArtifactContent";
import { MermaidDiagram } from "@/components/workspace/MermaidDiagram";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useProjectWorkspace } from "@/features/projects/project-workspace-context";
import { ProjectShell } from "@/screens/dashboard/ProjectShell";

export function DiagramsScreen() {
  const { visibleWorkspace: workspace } = useProjectWorkspace();
  if (!workspace) return null;
  return (
    <ProjectShell activeTab="diagrams">
      <div className="space-y-5">
        <section>
          <h2 className="text-xl font-semibold">Generated diagrams</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Revision-specific Mermaid artifacts. A failed item does not block
            the gallery.
          </p>
        </section>
        <Card>
          <CardHeader>
            <CardTitle>Architecture overview</CardTitle>
          </CardHeader>
          <CardContent>
            <MermaidDiagram source={workspace.mermaid} />
          </CardContent>
        </Card>
        <div className="grid gap-4 xl:grid-cols-2">
          {workspace.diagrams.map((artifact) => (
            <Card key={artifact.storage_key || artifact.url}>
              <CardHeader className="border-b border-border">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle>{artifact.name}</CardTitle>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {artifact.component_slug || "System"} · iteration{" "}
                      {artifact.iteration ?? "—"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Badge variant="outline">r{workspace.revisionNumber}</Badge>
                    <a href={artifact.url} target="_blank" rel="noreferrer">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Open ${artifact.name}`}
                      >
                        <ArrowSquareOut />
                      </Button>
                    </a>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="min-h-52 pt-5">
                <ArtifactContent
                  url={artifact.url}
                  storageKey={artifact.storage_key}
                  type="diagram"
                />
              </CardContent>
            </Card>
          ))}
        </div>
        {workspace.diagrams.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No generated diagram artifacts are available.
          </p>
        )}
      </div>
    </ProjectShell>
  );
}

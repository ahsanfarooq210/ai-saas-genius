import { useState } from "react";
import { ArrowSquareOut, BookOpenText } from "@phosphor-icons/react";
import { ArtifactContent } from "@/components/workspace/ArtifactContent";
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

export function DocumentationScreen() {
  const { visibleWorkspace: workspace } = useProjectWorkspace();
  const [selected, setSelected] = useState(0);
  if (!workspace) return null;
  const artifact =
    workspace.documents[
      Math.min(selected, Math.max(workspace.documents.length - 1, 0))
    ];
  return (
    <ProjectShell activeTab="documentation">
      <div className="grid gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Documents</CardTitle>
            <CardDescription>Generated Markdown artifacts</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {workspace.documents.map((item, index) => (
              <button
                type="button"
                key={item.storage_key || item.url}
                onClick={() => setSelected(index)}
                className={
                  index === selected
                    ? "w-full border border-primary bg-primary/5 p-3 text-left"
                    : "w-full border border-transparent p-3 text-left hover:bg-muted/50"
                }
              >
                <p className="text-xs font-medium">{item.name}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {item.component_slug || "System"}
                </p>
              </button>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b border-border">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="flex size-9 items-center justify-center border border-border bg-muted">
                  <BookOpenText className="size-5 text-primary" />
                </div>
                <div>
                  <CardTitle>{artifact?.name ?? "Documentation"}</CardTitle>
                  <CardDescription>
                    {artifact
                      ? `Revision ${workspace.revisionNumber}`
                      : "No generated documents"}
                  </CardDescription>
                </div>
              </div>
              {artifact && (
                <a href={artifact.url} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="outline">
                    <ArrowSquareOut />
                    Open source
                  </Button>
                </a>
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            {artifact ? (
              <ArtifactContent
                url={artifact.url}
                storageKey={artifact.storage_key}
                type="doc"
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                No generated documentation artifacts are available.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </ProjectShell>
  );
}

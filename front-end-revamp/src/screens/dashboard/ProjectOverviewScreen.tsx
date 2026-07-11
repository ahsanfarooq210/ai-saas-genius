import {
  FileText,
  GitBranch,
  Lightning,
  SquaresFour,
} from "@phosphor-icons/react";

import { MermaidDiagram } from "@/components/workspace/MermaidDiagram";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useProjectWorkspace } from "@/features/projects/project-workspace-context";
import { ProjectShell } from "@/screens/dashboard/ProjectShell";

export function ProjectOverviewScreen() {
  const { visibleWorkspace: workspace } = useProjectWorkspace();
  if (!workspace) return null;
  const summary = [
    ["Complexity", workspace.complexity ?? "—", Lightning],
    ["Components", workspace.componentList.length, GitBranch],
    ["Diagrams", workspace.diagrams.length, SquaresFour],
    ["Documents", workspace.documents.length, FileText],
  ] as const;
  return (
    <ProjectShell activeTab="overview">
      <div className="space-y-5">
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {summary.map(([label, value, Icon]) => (
            <div key={label} className="border border-border bg-card p-3">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-[10px] font-medium uppercase tracking-[0.12em]">
                  {label}
                </span>
                <Icon className="size-4" />
              </div>
              <p className="mt-2 text-2xl font-semibold tracking-tight">
                {value}
              </p>
            </div>
          ))}
        </section>
        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle>Latest successful instruction</CardTitle>
          </CardHeader>
          <CardContent className="pt-5 text-sm leading-7 text-muted-foreground">
            {workspace.latestInstruction || workspace.requirement}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle>Architecture draft</CardTitle>
          </CardHeader>
          <CardContent className="whitespace-pre-wrap pt-5 text-sm leading-7 text-muted-foreground">
            {workspace.architectureDraft ||
              "No architecture summary was generated."}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle>System map</CardTitle>
          </CardHeader>
          <CardContent className="pt-5">
            <MermaidDiagram source={workspace.mermaid} />
          </CardContent>
        </Card>
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Scalability review</CardTitle>
            </CardHeader>
            <CardContent className="whitespace-pre-wrap text-xs leading-6 text-muted-foreground">
              {workspace.scalabilityFeedback || "No feedback available."}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Security review</CardTitle>
            </CardHeader>
            <CardContent className="whitespace-pre-wrap text-xs leading-6 text-muted-foreground">
              {workspace.securityFeedback || "No feedback available."}
            </CardContent>
          </Card>
        </div>
      </div>
    </ProjectShell>
  );
}

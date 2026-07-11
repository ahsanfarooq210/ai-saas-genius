import { ArrowBendDownRight, Code, GitBranch } from '@phosphor-icons/react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ProjectShell } from '@/screens/dashboard/ProjectShell'

const components = [
  ['Edge API', 'Accepts short-link requests and issues low-latency redirects.', ['Link service', 'Event queue']],
  ['Link service', 'Owns link resolution, brand domains, and workspace policy.', ['Redis', 'Postgres']],
  ['Analytics worker', 'Consumes click events and shapes them for queryable reporting.', ['Event queue', 'Analytics store']],
  ['Workspace service', 'Manages team membership, access boundaries, and audit context.', ['Postgres']],
] as const

export function ArchitectureScreen() {
  return (
    <ProjectShell activeTab="architecture">
      <div className="space-y-5"><section><h2 className="text-xl font-semibold">Component map</h2><p className="mt-1 text-sm text-muted-foreground">A human-friendly view of the persisted system boundaries and relationships.</p></section><div className="grid gap-4 md:grid-cols-2">{components.map(([name, description, relations]) => <Card key={name}><CardHeader><GitBranch className="size-5 text-primary" /><CardTitle className="mt-3">{name}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent className="border-t border-border pt-4"><p className="mb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Relationships</p><div className="flex flex-wrap gap-2">{relations.map((relation) => <span key={relation} className="inline-flex items-center gap-1 border border-border bg-muted px-2 py-1 text-[10px] text-muted-foreground"><ArrowBendDownRight className="size-3" />{relation}</span>)}</div></CardContent></Card>)}</div><Card><CardHeader className="border-b border-border"><CardTitle className="flex items-center gap-2"><Code />Raw architecture JSON</CardTitle><CardDescription>Technical source is available for inspection in the completed workspace.</CardDescription></CardHeader><CardContent className="pt-5"><pre className="overflow-auto bg-muted/40 p-4 font-mono text-xs leading-6 text-muted-foreground">{`{\n  "edge_api": { "depends_on": ["link_service"] },\n  "link_service": { "stores": ["redis", "postgres"] }\n}`}</pre></CardContent></Card></div>
    </ProjectShell>
  )
}

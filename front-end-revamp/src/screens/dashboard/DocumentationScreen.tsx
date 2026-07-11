import { BookOpenText, FileText, ListBullets } from '@phosphor-icons/react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ProjectShell } from '@/screens/dashboard/ProjectShell'

const documents = [
  ['System overview', 'System', 'The primary architecture, boundaries, and key decisions.'],
  ['Redirect service', 'Link service', 'Request handling, cache strategy, and failure modes.'],
  ['Analytics pipeline', 'Analytics worker', 'Events, delivery guarantees, and reporting schema.'],
  ['Security model', 'Workspace service', 'Tenant isolation, roles, and audit requirements.'],
] as const

export function DocumentationScreen() {
  return (
    <ProjectShell activeTab="documentation">
      <div className="grid gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]"><Card><CardHeader><CardTitle>Documents</CardTitle><CardDescription>Generated Markdown artifacts</CardDescription></CardHeader><CardContent className="space-y-1">{documents.map(([title, component], index) => <div key={title} className={index === 0 ? 'border border-primary bg-primary/5 p-3' : 'border border-transparent p-3'}><p className="text-xs font-medium">{title}</p><p className="mt-1 text-[10px] text-muted-foreground">{component}</p></div>)}</CardContent></Card><Card><CardHeader className="border-b border-border"><div className="flex items-start gap-3"><div className="flex size-9 items-center justify-center border border-border bg-muted"><BookOpenText className="size-5 text-primary" /></div><div><CardTitle>System overview</CardTitle><CardDescription>Generated documentation preview</CardDescription></div></div></CardHeader><CardContent className="space-y-5 pt-6 text-sm leading-7 text-muted-foreground"><div><h2 className="text-xl font-semibold text-foreground">URL shortener architecture</h2><p className="mt-2">This system separates the latency-sensitive redirect path from asynchronous analytics processing. Each boundary is designed to make scaling and operational ownership clear.</p></div><div><h3 className="font-semibold text-foreground">Core decisions</h3><ul className="mt-2 list-disc space-y-1 pl-5"><li>Resolve links through a cache-backed service.</li><li>Publish click events outside the redirect response path.</li><li>Keep workspace metadata and access policies in a relational store.</li></ul></div><div className="border border-border bg-muted/40 p-3 font-mono text-xs leading-6"><FileText className="mb-2 size-4 text-primary" />docs/system-overview.md</div><p className="flex items-center gap-2 text-xs"><ListBullets className="size-4 text-primary" />This reader is static UI; artifact loading can be connected later.</p></CardContent></Card></div>
    </ProjectShell>
  )
}

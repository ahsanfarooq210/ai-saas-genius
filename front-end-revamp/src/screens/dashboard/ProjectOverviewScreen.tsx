import { ArrowsClockwise, FileText, GitBranch, Lightning, SquaresFour } from '@phosphor-icons/react'

import { demoProject } from '@/data/dashboard-demo'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ProjectShell } from '@/screens/dashboard/ProjectShell'

const summary = [
  ['Complexity', demoProject.complexity, Lightning],
  ['Components', String(demoProject.components), GitBranch],
  ['Diagrams', String(demoProject.diagrams), SquaresFour],
  ['Documents', String(demoProject.documents), FileText],
  ['Iterations', String(demoProject.iterations), ArrowsClockwise],
] as const

export function ProjectOverviewScreen() {
  return (
    <ProjectShell activeTab="overview">
      <div className="space-y-5"><section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{summary.map(([label, value, Icon]) => <div key={label} className="border border-border bg-card p-3"><div className="flex items-center justify-between text-muted-foreground"><span className="text-[10px] font-medium uppercase tracking-[0.12em]">{label}</span><Icon className="size-4" /></div><p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p></div>)}</section><Card><CardHeader className="border-b border-border"><CardTitle>Architecture draft</CardTitle></CardHeader><CardContent className="pt-5 text-sm leading-7 text-muted-foreground">The system uses an edge API for redirects, an asynchronous event pipeline for analytics, and a relational source of truth for link and workspace metadata. Redis absorbs redirect lookups; analytics events flow into durable storage without adding latency to the redirect path.</CardContent></Card><div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]"><Card><CardHeader className="border-b border-border"><CardTitle>System map</CardTitle></CardHeader><CardContent className="pt-5"><pre className="overflow-auto border border-border bg-muted/40 p-4 font-mono text-xs leading-6 text-muted-foreground">{`flowchart LR\n  Client --> EdgeAPI\n  EdgeAPI --> LinkService\n  LinkService --> Redis\n  LinkService --> Postgres\n  EdgeAPI --> EventQueue\n  EventQueue --> AnalyticsStore`}</pre></CardContent></Card><Card><CardHeader><CardTitle>Project health</CardTitle></CardHeader><CardContent className="space-y-3 text-xs"><p className="flex justify-between"><span className="text-muted-foreground">Documentation</span><span className="text-emerald-700 dark:text-emerald-400">Complete</span></p><p className="flex justify-between"><span className="text-muted-foreground">Scalability</span><span className="text-emerald-700 dark:text-emerald-400">Approved</span></p><p className="flex justify-between"><span className="text-muted-foreground">Security</span><span className="text-emerald-700 dark:text-emerald-400">Approved</span></p></CardContent></Card></div></div>
    </ProjectShell>
  )
}

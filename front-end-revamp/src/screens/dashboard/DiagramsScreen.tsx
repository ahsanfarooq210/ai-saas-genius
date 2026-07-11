import { ArrowsOut, ChartLineUp, FlowArrow, Network, SquaresFour } from '@phosphor-icons/react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ProjectShell } from '@/screens/dashboard/ProjectShell'

const diagrams = [
  ['System overview', FlowArrow, 'How requests, services, and event processing fit together.'],
  ['Redirect sequence', ArrowsOut, 'The request path from a short link to an analytics event.'],
  ['Data topology', Network, 'Durable storage, caching, and event collection boundaries.'],
  ['Analytics pipeline', ChartLineUp, 'How raw clicks become queryable product analytics.'],
] as const

export function DiagramsScreen() {
  return (
    <ProjectShell activeTab="diagrams">
      <div className="space-y-5"><section><h2 className="text-xl font-semibold">Generated diagrams</h2><p className="mt-1 text-sm text-muted-foreground">A visual library of the final persisted architecture artifacts.</p></section><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{diagrams.map(([name, Icon, description], index) => <Card key={name} className="overflow-hidden"><div className="flex aspect-[16/10] items-center justify-center border-b border-border bg-muted/40"><div className="flex size-14 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-primary"><Icon className="size-7" /></div></div><CardHeader><div className="flex items-center justify-between gap-2"><CardTitle>{name}</CardTitle><Badge variant="outline">v{index < 2 ? 2 : 1}</Badge></div></CardHeader><CardContent className="pb-4 text-xs leading-5 text-muted-foreground">{description}</CardContent></Card>)}</div><p className="flex items-center gap-2 text-xs text-muted-foreground"><SquaresFour className="size-4" />Artifact preview actions can be wired to persisted diagram URLs later.</p></div>
    </ProjectShell>
  )
}

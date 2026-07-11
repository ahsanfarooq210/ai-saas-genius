import { Lightning, Play, ShieldCheck, SquaresFour } from '@phosphor-icons/react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { DashboardShell } from '@/screens/dashboard/DashboardShell'

export function NewArchitectureScreen() {
  return (
    <DashboardShell>
      <div className="mx-auto max-w-5xl space-y-6 py-3">
        <section><Badge variant="outline" className="gap-1 border-primary/30 bg-primary/10 text-primary"><Lightning weight="fill" />New architecture</Badge><h1 className="mt-4 text-3xl font-semibold tracking-tight">Design your system</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Start with the product, users, scale, integrations, and constraints. The workspace will shape the rest into a durable project.</p></section>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <Card><CardHeader className="border-b border-border"><CardTitle>What are you building?</CardTitle><CardDescription>Keep the brief concrete enough for the architecture team to make useful tradeoffs.</CardDescription></CardHeader><CardContent className="space-y-4 pt-5"><Textarea readOnly placeholder="Describe the product, users, scale, integrations, constraints, and non-functional requirements…" className="min-h-60 resize-none p-4 text-sm leading-6" /><div className="flex items-center justify-between border-t border-border pt-4"><p className="max-w-sm text-xs leading-5 text-muted-foreground">A project thread is created when the architecture run begins.</p><Button><Play weight="fill" />Generate architecture</Button></div></CardContent></Card>
          <div className="space-y-4"><Card><CardHeader><CardTitle className="text-sm">What you will receive</CardTitle></CardHeader><CardContent className="space-y-4">{[[SquaresFour, 'System diagrams'], [ShieldCheck, 'Security review'], [Lightning, 'Scalability review']].map(([Icon, label]) => { const ItemIcon = Icon as typeof SquaresFour; return <div key={label as string} className="flex items-center gap-3"><div className="flex size-8 items-center justify-center border border-border bg-muted"><ItemIcon className="size-4 text-primary" /></div><span className="text-xs font-medium">{label as string}</span></div> })}</CardContent></Card><p className="px-1 text-xs leading-5 text-muted-foreground">This is a presentation-only composer. Run controls can be wired to the swarm API later.</p></div>
        </div>
      </div>
    </DashboardShell>
  )
}

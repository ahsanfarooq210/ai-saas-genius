import { CheckCircle, ShieldCheck, TrendUp } from '@phosphor-icons/react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ProjectShell } from '@/screens/dashboard/ProjectShell'

const reviews = [
  ['Scalability review', TrendUp, 'Approved', 'The redirect path is isolated from analytics writes, while cache and queue boundaries support horizontal scaling.'],
  ['Security review', ShieldCheck, 'Approved', 'Workspace ownership, token boundaries, and audit context are represented in the system design.'],
] as const

export function ReviewsScreen() {
  return (
    <ProjectShell activeTab="reviews">
      <div className="space-y-5"><section><h2 className="text-xl font-semibold">Design reviews</h2><p className="mt-1 text-sm text-muted-foreground">Final reviewer feedback attached to the persisted architecture.</p></section><div className="grid gap-5 lg:grid-cols-2">{reviews.map(([title, Icon, verdict, feedback]) => <Card key={title}><CardHeader className="border-b border-border"><div className="flex items-start justify-between gap-3"><div><Icon className="size-5 text-primary" /><CardTitle className="mt-3">{title}</CardTitle><CardDescription>Final review verdict</CardDescription></div><Badge variant="outline" className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"><CheckCircle weight="fill" />{verdict}</Badge></div></CardHeader><CardContent className="pt-5 text-sm leading-7 text-muted-foreground">{feedback}</CardContent></Card>)}</div><Card><CardHeader className="border-b border-border"><CardTitle>Review history</CardTitle><CardDescription>Architecture iterations are represented chronologically.</CardDescription></CardHeader><CardContent className="space-y-4 pt-5">{[['Architecture reviewer', 'Iteration 1', 'Requested a clearer cache invalidation path.'], ['Security reviewer', 'Iteration 2', 'Approved final workspace authorization boundary.']].map(([agent, iteration, feedback]) => <div key={agent} className="border-l-2 border-primary/50 pl-4"><div className="flex flex-wrap items-center gap-2"><p className="text-xs font-medium">{agent}</p><span className="text-[10px] text-muted-foreground">{iteration}</span></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{feedback}</p></div>)}</CardContent></Card></div>
    </ProjectShell>
  )
}

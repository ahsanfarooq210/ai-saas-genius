import { CheckCircle, ClockCounterClockwise, Cpu, FileText, SquaresFour } from '@phosphor-icons/react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ProjectShell } from '@/screens/dashboard/ProjectShell'

export function RuntimeScreen() {
  return (
    <ProjectShell activeTab="runtime">
      <div className="space-y-5"><section><Badge variant="outline" className="gap-1"><Cpu />Advanced view</Badge><h2 className="mt-3 text-xl font-semibold">Runtime checkpoint</h2><p className="mt-1 text-sm text-muted-foreground">A presentation of graph state that can be connected to the checkpoint API later.</p></section><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[['Next agent', 'Complete', CheckCircle], ['Iteration', '2', ClockCounterClockwise], ['Diagrams', '4 generated', SquaresFour], ['Documents', '6 generated', FileText]].map(([label, value, Icon]) => { const MetricIcon = Icon as typeof Cpu; return <div key={label as string} className="border border-border bg-card p-4"><MetricIcon className="size-4 text-primary" /><p className="mt-3 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{label as string}</p><p className="mt-1 text-lg font-semibold">{value as string}</p></div> })}</div><div className="grid gap-5 lg:grid-cols-2"><Card><CardHeader><CardTitle>Checkpoint summary</CardTitle><CardDescription>Final persisted graph signals</CardDescription></CardHeader><CardContent className="space-y-3 text-xs text-muted-foreground"><p className="flex justify-between"><span>Next nodes</span><span className="font-mono text-foreground">[]</span></p><p className="flex justify-between"><span>Docs complete</span><span className="text-emerald-700 dark:text-emerald-400">Yes</span></p><p className="flex justify-between"><span>Debate log count</span><span className="text-foreground">2</span></p></CardContent></Card><Card><CardHeader><CardTitle>Event trail</CardTitle><CardDescription>Most recent graph milestones</CardDescription></CardHeader><CardContent className="space-y-3">{['Architecture approved', 'Diagram artifacts generated', 'Documentation artifacts generated'].map((item) => <div key={item} className="flex items-center gap-3 text-xs"><span className="size-2 rounded-full bg-emerald-500" />{item}</div>)}</CardContent></Card></div></div>
    </ProjectShell>
  )
}

import { ArrowRight, FileText, GitBranch, ShieldCheck, SquaresFour } from '@phosphor-icons/react'
import { Link } from 'react-router-dom'

import { recentProjects } from '@/data/dashboard-demo'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DashboardShell } from '@/screens/dashboard/DashboardShell'

export function DashboardHomeScreen() {
  return (
    <DashboardShell>
      <div className="space-y-8 py-3">
        <section className="relative overflow-hidden border border-border bg-card p-6 shadow-sm sm:p-10">
          <div className="absolute -right-28 -top-28 size-72 rounded-full bg-primary/10 blur-3xl" />
          <div className="relative max-w-3xl">
            <Badge variant="outline" className="mb-5 border-primary/30 bg-primary/10 text-primary">Architecture workspace</Badge>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">Give your next system a thoughtful starting point.</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">Turn an early product brief into an architecture, diagrams, documentation, and technical review in one focused workspace.</p>
            <Link to="/dashboard/new" className="mt-6 inline-flex"><Button size="lg">Design a system <ArrowRight /></Button></Link>
          </div>
        </section>
        <section className="grid gap-4 md:grid-cols-3">
          {[
            [GitBranch, 'Architecture draft', 'A concrete system map and component boundaries.'],
            [SquaresFour, 'Generated artifacts', 'Diagrams and implementation-ready documentation.'],
            [ShieldCheck, 'Design reviews', 'Scalability and security feedback at the right time.'],
          ].map(([Icon, title, description]) => { const FeatureIcon = Icon as typeof GitBranch; return <Card key={title as string}><CardHeader><FeatureIcon className="size-5 text-primary" /><CardTitle className="mt-3">{title as string}</CardTitle><CardDescription>{description as string}</CardDescription></CardHeader></Card> })}
        </section>
        <section>
          <div className="mb-3 flex items-center justify-between"><div><h2 className="text-lg font-semibold">Recent projects</h2><p className="text-xs text-muted-foreground">Projects you have opened recently in this workspace.</p></div><Link to="/dashboard/projects"><Button size="sm" variant="outline">View all</Button></Link></div>
          <div className="grid gap-3 md:grid-cols-3">{recentProjects.map((project) => <Link key={project.threadId} to={`/dashboard/projects/${project.threadId}`}><Card className="h-full transition-colors hover:ring-primary/40"><CardHeader><div className="flex items-center justify-between gap-2"><CardTitle className="truncate">{project.name}</CardTitle><Badge variant="outline">{project.status}</Badge></div><CardDescription>{project.updated}</CardDescription></CardHeader><CardContent><div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground"><FileText className="size-3.5" />{project.threadId}</div></CardContent></Card></Link>)}</div>
        </section>
      </div>
    </DashboardShell>
  )
}

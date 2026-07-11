import { ArrowRight, ClockCounterClockwise, Plus } from '@phosphor-icons/react'
import { Link } from 'react-router-dom'

import { recentProjects } from '@/data/dashboard-demo'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DashboardShell } from '@/screens/dashboard/DashboardShell'

export function ProjectsScreen() {
  return (
    <DashboardShell>
      <div className="space-y-6 py-3">
        <section className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-medium uppercase tracking-[0.14em] text-primary">Architecture workspace</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Projects</h1><p className="mt-2 text-sm text-muted-foreground">Open a project to review its final architecture, artifacts, and reviews.</p></div><Link to="/dashboard/projects/new"><Button><Plus />New project</Button></Link></section>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{recentProjects.map((project) => <Link key={project.threadId} to={`/dashboard/projects/${project.threadId}`}><Card className="h-full transition-colors hover:ring-primary/40"><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle>{project.name}</CardTitle><CardDescription className="mt-1">Updated {project.updated}</CardDescription></div><Badge variant="outline">{project.status}</Badge></div></CardHeader><CardContent className="flex items-center justify-between border-t border-border pt-4"><span className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground"><ClockCounterClockwise className="size-3" />{project.threadId}</span><ArrowRight className="size-4 text-primary" /></CardContent></Card></Link>)}</div>
      </div>
    </DashboardShell>
  )
}

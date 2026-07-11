import type { ReactNode } from 'react'
import { ArrowLeft, CheckCircle, Copy, Plus } from '@phosphor-icons/react'
import { Link, useParams } from 'react-router-dom'

import { demoProject, projectTabs, type ProjectTab } from '@/data/dashboard-demo'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DashboardShell } from '@/screens/dashboard/DashboardShell'

interface ProjectShellProps {
  readonly activeTab: ProjectTab
  readonly children: ReactNode
}

export function ProjectShell({ activeTab, children }: ProjectShellProps) {
  const { threadId = demoProject.threadId } = useParams()
  const projectPath = `/dashboard/projects/${threadId}`

  return (
    <DashboardShell>
      <div className="space-y-6">
        <Link to="/dashboard/projects" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="size-3.5" /> All projects
        </Link>
        <section className="border border-border bg-card p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"><CheckCircle weight="fill" />{demoProject.status}</Badge>
                <span className="text-xs text-muted-foreground">Created {demoProject.createdAt}</span>
              </div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{demoProject.name}</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{demoProject.requirement}</p>
              <div className="mt-3 flex items-center gap-2"><code className="max-w-64 truncate border border-border bg-muted px-2 py-1 font-mono text-[10px]">{threadId}</code><Button size="xs" variant="ghost"><Copy />Copy ID</Button></div>
            </div>
            <Link to="/dashboard/new"><Button><Plus />New architecture</Button></Link>
          </div>
        </section>
        <nav className="flex gap-1 overflow-x-auto border-b border-border pb-1" aria-label="Project workspace">
          {projectTabs.map((tab) => <Link key={tab.value} to={tab.value === 'overview' ? `${projectPath}/overview` : `${projectPath}/${tab.value}`} className={activeTab === tab.value ? 'border-b-2 border-foreground px-3 py-2 text-xs font-medium text-foreground' : 'border-b-2 border-transparent px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground'}>{tab.label}</Link>)}
        </nav>
        {children}
      </div>
    </DashboardShell>
  )
}

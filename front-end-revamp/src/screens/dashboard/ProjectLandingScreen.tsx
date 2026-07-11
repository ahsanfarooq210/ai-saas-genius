import { ArrowRight, FileText, GitBranch, ShieldCheck, SquaresFour } from '@phosphor-icons/react'
import { Link, useParams } from 'react-router-dom'

import { demoProject } from '@/data/dashboard-demo'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ProjectShell } from '@/screens/dashboard/ProjectShell'

export function ProjectLandingScreen() {
  const { threadId = demoProject.threadId } = useParams()
  const projectPath = `/dashboard/projects/${threadId}`
  const sections = [
    [GitBranch, 'Architecture', 'Review the component map and system boundaries.', 'architecture'],
    [SquaresFour, 'Diagrams', 'Browse the generated system visuals.', 'diagrams'],
    [FileText, 'Documentation', 'Read the generated technical artifacts.', 'documentation'],
    [ShieldCheck, 'Reviews', 'See scalability and security feedback.', 'reviews'],
  ] as const

  return (
    <ProjectShell activeTab="overview">
      <section className="grid gap-4 md:grid-cols-2">{sections.map(([Icon, title, description, tab]) => <Link key={tab} to={`${projectPath}/${tab}`}><Card className="h-full transition-colors hover:ring-primary/40"><CardHeader><Icon className="size-5 text-primary" /><CardTitle className="mt-3">{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent className="flex items-center gap-1.5 text-xs text-primary">Open {title.toLowerCase()} <ArrowRight className="size-3.5" /></CardContent></Card></Link>)}</section>
    </ProjectShell>
  )
}

import {
  ArrowsClockwise,
  ArrowSquareOut,
  CaretDown,
  Check,
  CheckCircle,
  ClipboardText,
  ClockCounterClockwise,
  Code,
  Copy,
  FileText,
  FlowArrow,
  GitBranch,
  Lightning,
  ListBullets,
  Play,
  Plus,
  ShieldCheck,
  Spinner,
  SquaresFour,
  WarningCircle,
} from '@phosphor-icons/react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { getSwarmSession, getSwarmState, streamSwarmResume, streamSwarmRun } from '@/api/swarm'
import type {
  Artifact,
  SwarmCheckpointResponse,
  SwarmProgressEvent,
  SwarmSessionResponse,
} from '@/api/swarm'
import { AppSidebar } from '@/components/dashboard/app-sidebar'
import { DashboardNavbar } from '@/components/dashboard/dashboard-navbar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type DashboardMode = 'new' | 'live' | 'workspace'

type RecentProject = {
  threadId: string
  label: string
  status: string
  lastOpenedAt: string
}

type RunMetrics = {
  components: number | null
  diagrams: number | null
  documents: number | null
  iteration: number | null
}

const RECENT_PROJECTS_KEY = 'architecture-swarm-recent-projects'
const phases = [
  { id: 'supervisor', label: 'Planning', icon: FlowArrow },
  { id: 'architecture', label: 'Architecture', icon: GitBranch },
  { id: 'diagram', label: 'Diagrams', icon: SquaresFour },
  { id: 'documentation', label: 'Documentation', icon: FileText },
  { id: 'review', label: 'Review', icon: ShieldCheck },
] as const

function createThreadId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `swarm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function titleFromRequirement(requirement: string): string {
  const trimmed = requirement.trim().replace(/\s+/g, ' ')
  return trimmed.length > 76 ? `${trimmed.slice(0, 73)}…` : trimmed || 'Untitled architecture'
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Not available'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function extractMetric(payload: Record<string, unknown>, names: string[]): number | null {
  for (const name of names) {
    const result = readNumber(payload[name])
    if (result !== null) return result
  }
  return null
}

function verdictFromFeedback(feedback: string | null | undefined): 'approved' | 'rejected' | 'unavailable' {
  const normalized = feedback?.toUpperCase() ?? ''
  if (normalized.includes('REJECTED')) return 'rejected'
  if (normalized.includes('APPROVED')) return 'approved'
  return 'unavailable'
}

function statusClass(status: string | null | undefined): string {
  const normalized = status?.toLowerCase() ?? ''
  if (normalized.includes('fail') || normalized.includes('reject')) return 'border-destructive/30 bg-destructive/10 text-destructive'
  if (normalized.includes('complete') || normalized.includes('done') || normalized.includes('approved')) return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
  return 'border-primary/30 bg-primary/10 text-primary'
}

function SessionStatusBadge({ status }: Readonly<{ status: string }>) {
  const label = status === 'running' ? 'Running' : status === 'failed' ? 'Failed' : status === 'complete' ? 'Complete' : status || 'Unknown'
  return <Badge variant="outline" className={cn('gap-1.5 capitalize', statusClass(status))}>{status === 'running' && <Spinner className="size-3 animate-spin" />}{label}</Badge>
}

function MetricCard({ label, value, icon: Icon }: Readonly<{ label: string; value: number | null | undefined; icon: typeof SquaresFour }>) {
  return (
    <div className="border border-border bg-card p-3">
      <div className="flex items-center justify-between text-muted-foreground"><span className="text-[11px] font-medium uppercase tracking-[0.12em]">{label}</span><Icon className="size-4" /></div>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value ?? '—'}</p>
    </div>
  )
}

function CopyButton({ value, label = 'Copy' }: Readonly<{ value: string; label?: string }>) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard access can be blocked in non-secure browser contexts.
    }
  }
  return <Button type="button" size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs" onClick={() => void copy()}><>{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}</>{copied ? 'Copied' : label}</Button>
}

function NewArchitecture({ onStart, onOpen }: Readonly<{ onStart: (requirement: string) => void; onOpen: (threadId: string) => void }>) {
  const [requirement, setRequirement] = useState('')
  const [existingThreadId, setExistingThreadId] = useState('')
  const [showError, setShowError] = useState(false)
  const [recents] = useState<RecentProject[]>(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_PROJECTS_KEY) ?? '[]') as RecentProject[] } catch { return [] }
  })

  const submit = () => {
    if (!requirement.trim()) { setShowError(true); return }
    onStart(requirement.trim())
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 py-5 lg:py-12">
      <section className="relative overflow-hidden border border-border bg-card p-6 shadow-sm sm:p-10">
        <div className="absolute -right-28 -top-28 size-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative max-w-3xl">
          <Badge variant="outline" className="mb-5 gap-1.5 border-primary/30 bg-primary/10 text-primary"><Lightning weight="fill" />Architecture swarm</Badge>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">Design your system</h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">Turn a product requirement into a considered system design, diagram set, technical documentation, and review feedback.</p>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle>What are you building?</CardTitle>
            <CardDescription>Include the product, users, scale, integrations, constraints, and non-functional requirements.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-5">
            <Textarea value={requirement} onChange={(event) => { setRequirement(event.target.value); setShowError(false) }} placeholder="Describe the product, users, scale, integrations, constraints, and non-functional requirements…" className="min-h-52 resize-y p-4 text-sm leading-6" aria-invalid={showError} />
            {showError && <p className="text-xs text-destructive">Describe the system you want to design before generating an architecture.</p>}
            <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-5 text-muted-foreground">A durable project ID is created when the run starts, so you can return to the same architecture later.</p>
              <Button className="gap-2 sm:shrink-0" onClick={submit}>Generate architecture <Play weight="fill" /></Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle className="text-sm">Your design workspace</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {[
                ['Architecture', 'Draft and structured system map'],
                ['Artifacts', 'Diagrams and Markdown docs'],
                ['Reviews', 'Scalability and security feedback'],
              ].map(([title, description]) => <div key={title} className="flex gap-3"><CheckCircle className="mt-0.5 size-4 text-primary" weight="fill" /><div><p className="text-xs font-medium">{title}</p><p className="text-xs leading-5 text-muted-foreground">{description}</p></div></div>)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Open existing project</CardTitle><CardDescription>Use a thread ID shared by a previous run.</CardDescription></CardHeader>
            <CardContent className="space-y-2"><Input value={existingThreadId} onChange={(event) => setExistingThreadId(event.target.value)} placeholder="thread_id" className="font-mono text-xs" /><Button variant="outline" className="w-full" disabled={!existingThreadId.trim()} onClick={() => onOpen(existingThreadId.trim())}>Open project</Button></CardContent>
          </Card>
        </div>
      </div>

      {recents.length > 0 && <section><div className="mb-3 flex items-center gap-2"><ClockCounterClockwise className="size-4 text-muted-foreground" /><h2 className="text-sm font-medium">Recent projects</h2></div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{recents.slice(0, 6).map((project) => <button key={project.threadId} type="button" onClick={() => onOpen(project.threadId)} className="border border-border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"><div className="flex items-center justify-between gap-2"><p className="truncate text-xs font-medium">{project.label}</p><span className="size-1.5 shrink-0 rounded-full bg-primary" /></div><p className="mt-2 truncate font-mono text-[10px] text-muted-foreground">{project.threadId}</p><p className="mt-1 text-[10px] text-muted-foreground">Opened {formatDate(project.lastOpenedAt)}</p></button>)}</div><p className="mt-2 text-[11px] text-muted-foreground">Recent projects are stored only in this browser and may not include every server-side project.</p></section>}
    </div>
  )
}

function RunTimeline({ events, activePhase, rejected }: Readonly<{ events: SwarmProgressEvent[]; activePhase: string; rejected: boolean }>) {
  const activeIndex = Math.max(0, phases.findIndex((phase) => phase.id === activePhase))
  return <Card><CardHeader className="border-b border-border"><div className="flex items-center justify-between gap-4"><div><CardTitle>Execution timeline</CardTitle><CardDescription>Events update as the graph moves through its agents.</CardDescription></div>{rejected && <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400">Revision requested</Badge>}</div></CardHeader><CardContent className="pt-5"><ol className="space-y-0">{phases.map((phase, index) => { const state = index < activeIndex ? 'complete' : index === activeIndex ? 'active' : 'pending'; const Icon = phase.icon; const latest = [...events].reverse().find((event) => event.phase === phase.id); return <li key={phase.id} className="relative flex gap-3 pb-5 last:pb-0"><span className={cn('relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border', state === 'complete' && 'border-emerald-500 bg-emerald-500 text-white', state === 'active' && 'border-primary bg-primary text-primary-foreground', state === 'pending' && 'border-border bg-card text-muted-foreground')}><Icon className="size-3.5" /></span>{index < phases.length - 1 && <span className={cn('absolute left-[13px] top-7 h-[calc(100%-12px)] w-px', index < activeIndex ? 'bg-emerald-500' : 'bg-border')} />}<div className="min-w-0 pt-0.5"><div className="flex items-center gap-2"><p className="text-sm font-medium">{phase.label}</p>{state === 'active' && <span className="text-[10px] font-medium uppercase tracking-wider text-primary">Active</span>}</div><p className="mt-0.5 text-xs leading-5 text-muted-foreground">{latest?.message ?? (state === 'pending' ? 'Waiting for the graph' : 'Completed')}</p></div></li> })}</ol></CardContent></Card>
}

function LiveRun({ requirement, threadId, status, events, metrics, onResume, onCheckState, isChecking, recoveryMessage }: Readonly<{ requirement: string; threadId: string; status: string; events: SwarmProgressEvent[]; metrics: RunMetrics; onResume: () => void; onCheckState: () => void; isChecking: boolean; recoveryMessage: string | null }>) {
  const activePhase = events.at(-1)?.phase ?? 'supervisor'
  const rejected = events.some((event) => readString(event.payload.status)?.toUpperCase() === 'REJECTED')
  return <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 py-5"><section className="border border-border bg-card p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><div className="mb-3 flex flex-wrap items-center gap-2"><SessionStatusBadge status={status} />{rejected && <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400">Revision requested</Badge>}</div><h1 className="text-xl font-semibold tracking-tight">{titleFromRequirement(requirement)}</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{requirement}</p></div><div className="border border-border bg-muted/30 px-3 py-2"><p className="font-mono text-[10px] text-muted-foreground">{threadId}</p><CopyButton value={threadId} label="Copy ID" /></div></div></section><div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]"><div className="space-y-6"><RunTimeline events={events} activePhase={activePhase} rejected={rejected} /><Card><CardHeader className="border-b border-border"><CardTitle>Activity</CardTitle><CardDescription>A compact record of the latest streamed agent updates.</CardDescription></CardHeader><CardContent className="max-h-68 space-y-3 overflow-y-auto pt-4">{events.length === 0 ? <p className="text-xs text-muted-foreground">Connecting to the architecture swarm…</p> : [...events].reverse().slice(0, 12).map((event, index) => <div key={`${event.node}-${index}`} className="flex gap-3 border-l border-border pl-3"><span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary" /><div><p className="text-xs font-medium">{event.message || event.node}</p><p className="mt-1 font-mono text-[10px] text-muted-foreground">{event.phase} · iteration {event.iteration_count ?? '—'}</p></div></div>)}</CardContent></Card></div><aside className="space-y-5"><Card><CardHeader><CardTitle className="text-sm">Live signals</CardTitle></CardHeader><CardContent className="grid grid-cols-2 gap-2"><MetricCard label="Components" value={metrics.components} icon={GitBranch} /><MetricCard label="Diagrams" value={metrics.diagrams} icon={SquaresFour} /><MetricCard label="Documents" value={metrics.documents} icon={FileText} /><MetricCard label="Iteration" value={metrics.iteration} icon={ArrowsClockwise} /></CardContent></Card><Card><CardHeader><CardTitle className="text-sm">Results are loading</CardTitle><CardDescription>The final persisted workspace is fetched as soon as the run completes.</CardDescription></CardHeader><CardContent className="space-y-3"><Skeleton className="h-20" /><Skeleton className="h-10" /><Skeleton className="h-10" /></CardContent></Card>{status === 'failed' && <Card className="border-destructive/30"><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><WarningCircle className="text-destructive" />Connection interrupted</CardTitle><CardDescription>{recoveryMessage ?? 'The run may still be available on the server.'}</CardDescription></CardHeader><CardContent className="flex flex-col gap-2"><Button variant="outline" onClick={onCheckState} disabled={isChecking}>{isChecking ? <Spinner className="animate-spin" /> : <ArrowsClockwise />}Check current project state</Button><Button onClick={onResume}><Play weight="fill" />Resume run</Button></CardContent></Card>}</aside></div></div>
}

function ReviewCard({ title, feedback }: Readonly<{ title: string; feedback: string | null | undefined }>) {
  const verdict = verdictFromFeedback(feedback)
  const label = verdict === 'approved' ? 'Approved' : verdict === 'rejected' ? 'Rejected' : 'Not available'
  return <Card><CardHeader className="border-b border-border"><div className="flex items-start justify-between gap-3"><div><CardTitle>{title}</CardTitle><CardDescription>Final persisted reviewer feedback</CardDescription></div><Badge variant="outline" className={cn('capitalize', statusClass(verdict))}>{label}</Badge></div></CardHeader><CardContent className="whitespace-pre-wrap pt-4 text-sm leading-6 text-muted-foreground">{feedback?.trim() || 'No feedback was recorded for this review.'}</CardContent></Card>
}

function ArchitectureInspector({ session }: Readonly<{ session: SwarmSessionResponse }>) {
  const [rawOpen, setRawOpen] = useState(false)
  const entries = useMemo(() => {
    const root = session.architecture_json
    const componentMap = root.components
    if (Array.isArray(componentMap)) return componentMap.map((value, index) => [readString((value as Record<string, unknown>)?.name) ?? `Component ${index + 1}`, value] as const)
    if (componentMap && typeof componentMap === 'object') return Object.entries(componentMap as Record<string, unknown>)
    return Object.entries(root).filter(([key]) => !['components', 'relationships', 'metadata'].includes(key))
  }, [session.architecture_json])
  return <div className="space-y-5"><Card><CardHeader className="border-b border-border"><CardTitle>Component map</CardTitle><CardDescription>A defensive view of the architecture structure, shaped around available component fields.</CardDescription></CardHeader><CardContent className="grid gap-3 pt-5 md:grid-cols-2">{entries.length === 0 ? <p className="text-sm text-muted-foreground">No structured architecture data is available yet.</p> : entries.map(([name, value]) => { const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; const description = readString(record.description) ?? readString(record.summary) ?? (typeof value === 'string' ? value : 'No description provided.'); const relations = record.relationships ?? record.relations ?? record.dependencies; const relationItems = Array.isArray(relations) ? relations.map((relation) => typeof relation === 'string' ? relation : readString((relation as Record<string, unknown>)?.name) ?? JSON.stringify(relation)) : []; return <div key={name} className="border border-border bg-card p-4"><p className="font-medium">{name}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{description}</p>{relationItems.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{relationItems.map((relation) => <span key={relation} className="border border-border bg-muted px-2 py-1 text-[10px] text-muted-foreground">{relation}</span>)}</div>}</div> })}</CardContent></Card><Card><button type="button" className="flex w-full items-center justify-between p-4 text-left" onClick={() => setRawOpen(!rawOpen)}><span className="flex items-center gap-2 text-sm font-medium"><Code />Raw architecture JSON</span><CaretDown className={cn('transition-transform', rawOpen && 'rotate-180')} /></button>{rawOpen && <pre className="max-h-120 overflow-auto border-t border-border bg-muted/40 p-4 font-mono text-xs leading-5">{JSON.stringify(session.architecture_json, null, 2)}</pre>}</Card></div>
}

function ArtifactGallery({ artifacts, onSelect }: Readonly<{ artifacts: Artifact[]; onSelect: (artifact: Artifact) => void }>) {
  if (artifacts.length === 0) return <EmptyState icon={SquaresFour} title="No diagram artifacts yet" text="Generated diagrams will appear here when the architecture run persists them." />
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{artifacts.map((artifact) => <button key={`${artifact.url}-${artifact.name}`} type="button" onClick={() => onSelect(artifact)} className="group overflow-hidden border border-border bg-card text-left transition-colors hover:border-primary/50"><div className="relative flex aspect-[16/10] items-center justify-center bg-muted/50"><img src={artifact.url} alt={artifact.name} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" onError={(event) => { event.currentTarget.style.display = 'none' }} /><SquaresFour className="absolute size-7 text-muted-foreground" /></div><div className="p-3"><p className="truncate text-sm font-medium">{artifact.name || 'Untitled diagram'}</p><p className="mt-1 text-xs text-muted-foreground">{artifact.component_slug || 'System'} · iteration {artifact.iteration ?? '—'}</p></div></button>)}</div>
}

function DocumentReader({ artifacts }: Readonly<{ artifacts: Artifact[] }>) {
  const [selected, setSelected] = useState<Artifact | null>(artifacts[0] ?? null)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!selected) return
    const controller = new AbortController()
    void Promise.resolve().then(async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(selected.url, { signal: controller.signal })
        if (!response.ok) throw new Error('The document could not be loaded.')
        setContent(await response.text())
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'The document could not be loaded.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })
    return () => controller.abort()
  }, [selected])
  if (artifacts.length === 0) return <EmptyState icon={FileText} title="No documentation artifacts yet" text="Generated Markdown documentation will appear here when available." />
  return <div className="grid min-h-110 gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]"><aside className="border border-border bg-card p-2">{artifacts.map((artifact) => <button key={`${artifact.url}-${artifact.name}`} type="button" onClick={() => setSelected(artifact)} className={cn('w-full border p-3 text-left', selected?.url === artifact.url ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-muted')}><p className="truncate text-xs font-medium">{artifact.name || 'Untitled document'}</p><p className="mt-1 text-[10px] text-muted-foreground">{artifact.component_slug || 'System'}</p></button>)}</aside><Card className="min-w-0"><CardHeader className="border-b border-border"><div className="flex items-start justify-between gap-3"><div><CardTitle>{selected?.name || 'Document reader'}</CardTitle><CardDescription>{selected?.component_slug || 'Generated documentation'}</CardDescription></div>{selected && <div className="flex"><CopyButton value={selected.url} label="Link" /><Button size="sm" variant="ghost" render={<a href={selected.url} target="_blank" rel="noreferrer" />}><ArrowSquareOut /></Button></div>}</div></CardHeader><CardContent className="pt-5">{loading && <div className="space-y-3"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-11/12" /><Skeleton className="h-4 w-4/5" /></div>}{error && <p className="text-sm text-destructive">{error}</p>}{!loading && !error && (content ? <MarkdownDocument content={content} /> : <p className="text-sm text-muted-foreground">This document is empty.</p>)}</CardContent></Card></div>
}

function MarkdownDocument({ content }: Readonly<{ content: string }>) {
  return <article className="space-y-4 text-sm leading-7 text-muted-foreground">
    {content.split(/\n{2,}/).filter(Boolean).map((block, index) => {
      const trimmed = block.trim()
      if (trimmed.startsWith('```')) return <pre key={index} className="overflow-auto border border-border bg-muted/40 p-3 font-mono text-xs leading-6 text-foreground">{trimmed.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')}</pre>
      const heading = trimmed.match(/^(#{1,3})\s+(.+)/)
      if (heading) return <h3 key={index} className={cn('font-semibold text-foreground', heading[1].length === 1 ? 'text-xl' : 'text-base')}>{heading[2]}</h3>
      const listItems = trimmed.split('\n').filter((line) => /^[-*]\s+/.test(line))
      if (listItems.length === trimmed.split('\n').length) return <ul key={index} className="list-disc space-y-1 pl-5">{listItems.map((item) => <li key={item}>{item.replace(/^[-*]\s+/, '')}</li>)}</ul>
      return <p key={index} className="whitespace-pre-wrap">{trimmed}</p>
    })}
  </article>
}

function EmptyState({ icon: Icon, title, text }: Readonly<{ icon: typeof FileText; title: string; text: string }>) { return <div className="flex min-h-64 flex-col items-center justify-center border border-dashed border-border bg-card p-8 text-center"><Icon className="size-7 text-muted-foreground" /><p className="mt-3 text-sm font-medium">{title}</p><p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{text}</p></div> }

function RuntimePanel({ state, loading, onRefresh }: Readonly<{ state: SwarmCheckpointResponse | null; loading: boolean; onRefresh: () => void }>) { return <Card><CardHeader className="border-b border-border"><div className="flex items-start justify-between gap-4"><div><CardTitle className="flex items-center gap-2"><ClipboardText />Runtime checkpoint</CardTitle><CardDescription>Advanced, on-demand view of the persisted graph checkpoint.</CardDescription></div><Button size="sm" variant="outline" onClick={onRefresh} disabled={loading}>{loading ? <Spinner className="animate-spin" /> : <ArrowsClockwise />}Refresh</Button></div></CardHeader><CardContent className="pt-5">{loading ? <div className="grid gap-3 sm:grid-cols-3"><Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" /></div> : !state ? <p className="text-sm text-muted-foreground">Load the latest checkpoint only when you need runtime details.</p> : <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><MetricCard label="Diagrams" value={state.generated_diagram_count} icon={SquaresFour} /><MetricCard label="Documents" value={state.generated_doc_count} icon={FileText} /><MetricCard label="Iteration" value={state.iteration_count} icon={ArrowsClockwise} /><MetricCard label="Debates" value={state.debate_log_count} icon={ListBullets} /></div><div className="grid gap-4 md:grid-cols-2"><div className="border border-border p-4"><p className="text-xs font-medium">Next nodes</p><p className="mt-2 font-mono text-xs text-muted-foreground">{state.next.join(', ') || 'None'}</p></div><div className="border border-border p-4"><p className="text-xs font-medium">Run state</p><p className="mt-2 text-xs text-muted-foreground">Next agent: {state.next_agent || '—'} · Docs complete: {state.docs_complete ? 'Yes' : 'No'}</p></div></div></div>}</CardContent></Card> }

export function DashboardScreen() {
  const [mode, setMode] = useState<DashboardMode>('new')
  const [session, setSession] = useState<SwarmSessionResponse | null>(null)
  const [threadId, setThreadId] = useState('')
  const [requirement, setRequirement] = useState('')
  const [runStatus, setRunStatus] = useState('running')
  const [events, setEvents] = useState<SwarmProgressEvent[]>([])
  const [metrics, setMetrics] = useState<RunMetrics>({ components: null, diagrams: null, documents: null, iteration: null })
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isCheckingState, setIsCheckingState] = useState(false)
  const [runtimeState, setRuntimeState] = useState<SwarmCheckpointResponse | null>(null)
  const [runtimeLoading, setRuntimeLoading] = useState(false)
  const [selectedDiagram, setSelectedDiagram] = useState<Artifact | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  const rememberProject = useCallback((current: SwarmSessionResponse | { thread_id: string; requirement: string; status: string }) => {
    const project: RecentProject = { threadId: current.thread_id, label: titleFromRequirement(current.requirement), status: current.status, lastOpenedAt: new Date().toISOString() }
    try { const stored = JSON.parse(localStorage.getItem(RECENT_PROJECTS_KEY) ?? '[]') as RecentProject[]; localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify([project, ...stored.filter((item) => item.threadId !== project.threadId)].slice(0, 8))) } catch { /* localStorage can be unavailable in privacy-restricted browsers. */ }
  }, [])

  const showSession = useCallback((nextSession: SwarmSessionResponse) => {
    setSession(nextSession); setThreadId(nextSession.thread_id); setRequirement(nextSession.requirement); setRunStatus(nextSession.status); setMetrics({ components: nextSession.component_list?.length ?? null, diagrams: nextSession.diagram_count ?? nextSession.generated_diagrams?.length ?? null, documents: nextSession.doc_count ?? nextSession.generated_docs?.length ?? null, iteration: nextSession.iteration_count ?? null }); rememberProject(nextSession); setMode(nextSession.status === 'running' || nextSession.status === 'failed' ? 'live' : 'workspace')
  }, [rememberProject])

  const refreshSession = useCallback(async (id = threadId) => {
    if (!id) return
    setIsLoading(true); setLoadError(null)
    try { showSession(await getSwarmSession(id)) } catch (error) { setLoadError(error instanceof Error && error.message.includes('404') ? 'Project not found. Check the thread ID and try again.' : 'Unable to load this project right now.') } finally { setIsLoading(false) }
  }, [showSession, threadId])

  const receiveProgress = useCallback((event: SwarmProgressEvent) => {
    setEvents((current) => [...current, event])
    setMetrics((current) => ({ components: extractMetric(event.payload, ['component_count']) ?? current.components, diagrams: extractMetric(event.payload, ['diagram_count', 'generated_diagram_count']) ?? current.diagrams, documents: extractMetric(event.payload, ['doc_count', 'generated_doc_count']) ?? current.documents, iteration: event.iteration_count ?? current.iteration }))
  }, [])

  const startStream = useCallback((id: string, nextRequirement: string, resume: boolean) => {
    controllerRef.current?.abort(); setThreadId(id); setRequirement(nextRequirement); setRunStatus('running'); setEvents([]); setLoadError(null); setMode('live')
    const handlers = { onProgress: receiveProgress, onDone: () => { void refreshSession(id) }, onError: (event: { message: string }) => { setRunStatus('failed'); setLoadError(event.message) } }
    controllerRef.current = resume ? streamSwarmResume({ thread_id: id }, handlers) : streamSwarmRun({ thread_id: id, task_requirement: nextRequirement }, handlers)
  }, [receiveProgress, refreshSession])

  const startNew = (nextRequirement: string) => startStream(createThreadId(), nextRequirement, false)
  const resume = () => startStream(threadId, requirement, true)
  const openExisting = (id: string) => { setThreadId(id); setMode('live'); void refreshSession(id) }
  const checkCurrentState = async () => { if (!threadId) return; setIsCheckingState(true); try { const current = await getSwarmSession(threadId); showSession(current) } catch { setLoadError('The server could not confirm the current project state.') } finally { setIsCheckingState(false) } }
  const loadRuntime = async () => { if (!threadId) return; setRuntimeLoading(true); try { setRuntimeState(await getSwarmState(threadId)) } catch { setLoadError('Unable to load runtime checkpoint details.') } finally { setRuntimeLoading(false) } }
  useEffect(() => () => controllerRef.current?.abort(), [])

  const workspace = session && <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 py-5"><section className="border border-border bg-card p-5"><div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between"><div className="min-w-0"><div className="mb-3 flex flex-wrap items-center gap-2"><SessionStatusBadge status={session.status} /><span className="text-xs text-muted-foreground">Created {formatDate(session.created_at)}{session.completed_at && ` · Completed ${formatDate(session.completed_at)}`}</span></div><h1 className="text-2xl font-semibold tracking-tight">{titleFromRequirement(session.requirement)}</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{session.requirement}</p><div className="mt-3 flex items-center gap-2"><code className="max-w-55 truncate border border-border bg-muted px-2 py-1 font-mono text-[10px]">{session.thread_id}</code><CopyButton value={session.thread_id} label="Copy ID" /></div></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={resume}><Play weight="fill" />Resume</Button><Button variant="outline" onClick={() => void refreshSession()}><ArrowsClockwise />Refresh</Button><Button onClick={() => { controllerRef.current?.abort(); setSession(null); setMode('new') }}><Plus />New architecture</Button></div></div></section><Tabs defaultValue="overview"><TabsList variant="line" className="w-full justify-start overflow-x-auto border-b border-border pb-1"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="architecture">Architecture</TabsTrigger><TabsTrigger value="diagrams">Diagrams</TabsTrigger><TabsTrigger value="documentation">Documentation</TabsTrigger><TabsTrigger value="reviews">Reviews</TabsTrigger><TabsTrigger value="runtime">Runtime</TabsTrigger></TabsList><div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_17rem]"><div className="min-w-0"><TabsContent value="overview" className="space-y-5"><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"><MetricCard label="Complexity" value={session.complexity} icon={Lightning} /><MetricCard label="Components" value={session.component_list?.length} icon={GitBranch} /><MetricCard label="Diagrams" value={session.diagram_count ?? session.generated_diagrams?.length} icon={SquaresFour} /><MetricCard label="Documents" value={session.doc_count ?? session.generated_docs?.length} icon={FileText} /><MetricCard label="Iterations" value={session.iteration_count} icon={ArrowsClockwise} /></div><Card><CardHeader className="border-b border-border"><CardTitle>Architecture draft</CardTitle></CardHeader><CardContent className="whitespace-pre-wrap pt-5 text-sm leading-7 text-muted-foreground">{session.architecture_draft || 'No architecture draft is available.'}</CardContent></Card><Card><CardHeader className="border-b border-border"><CardTitle>Components</CardTitle></CardHeader><CardContent className="flex flex-wrap gap-2 pt-5">{session.component_list?.length ? session.component_list.map((component) => <span key={component} className="border border-border bg-muted/50 px-2.5 py-1.5 text-xs">{component}</span>) : <p className="text-sm text-muted-foreground">No components are available.</p>}</CardContent></Card><Card><CardHeader className="border-b border-border"><div className="flex items-center justify-between gap-3"><div><CardTitle>System map</CardTitle><CardDescription>Mermaid source is shown because this frontend does not include a Mermaid renderer.</CardDescription></div>{session.current_architecture_mermaid && <CopyButton value={session.current_architecture_mermaid} label="Copy source" />}</div></CardHeader><CardContent className="pt-5"><pre className="max-h-110 overflow-auto border border-border bg-muted/40 p-4 font-mono text-xs leading-6">{session.current_architecture_mermaid || 'No system map source is available.'}</pre></CardContent></Card></TabsContent><TabsContent value="architecture"><ArchitectureInspector session={session} /></TabsContent><TabsContent value="diagrams"><ArtifactGallery artifacts={session.generated_diagrams ?? []} onSelect={setSelectedDiagram} /></TabsContent><TabsContent value="documentation"><DocumentReader artifacts={session.generated_docs ?? []} /></TabsContent><TabsContent value="reviews" className="space-y-5"><div className="grid gap-5 lg:grid-cols-2"><ReviewCard title="Scalability review" feedback={session.scalability_feedback} /><ReviewCard title="Security review" feedback={session.security_feedback} /></div><Card><CardHeader className="border-b border-border"><CardTitle>Review history</CardTitle><CardDescription>Rejections may have caused another architecture pass; the displayed artifacts are the final persisted set.</CardDescription></CardHeader><CardContent className="space-y-3 pt-5">{session.debate_logs?.length ? session.debate_logs.map((log, index) => <div key={`${log.agent}-${log.iteration}-${index}`} className="border-l-2 border-primary/50 pl-4"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">{log.agent || 'Reviewer'}</p><Badge variant="outline" className={cn('text-[10px]', statusClass(log.status))}>{log.status || 'Unknown'}</Badge><span className="text-xs text-muted-foreground">Iteration {log.iteration ?? '—'}</span></div><p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-muted-foreground">{log.feedback || 'No feedback text recorded.'}</p></div>) : <p className="text-sm text-muted-foreground">No review history is available.</p>}</CardContent></Card></TabsContent><TabsContent value="runtime"><RuntimePanel state={runtimeState} loading={runtimeLoading} onRefresh={() => void loadRuntime()} /></TabsContent></div><aside className="space-y-5"><Card><CardHeader><CardTitle className="text-sm">Project health</CardTitle></CardHeader><CardContent className="space-y-3 text-xs"><HealthRow label="Documentation" value={session.docs_complete ? 'Complete' : 'In progress'} good={session.docs_complete} /><HealthRow label="Scalability" value={verdictFromFeedback(session.scalability_feedback)} good={verdictFromFeedback(session.scalability_feedback) === 'approved'} /><HealthRow label="Security" value={verdictFromFeedback(session.security_feedback)} good={verdictFromFeedback(session.security_feedback) === 'approved'} /><HealthRow label="Artifacts" value={`${session.generated_diagrams?.length ?? 0} diagrams · ${session.generated_docs?.length ?? 0} docs`} good /></CardContent></Card><Card><CardHeader><CardTitle className="text-sm">Run metadata</CardTitle></CardHeader><CardContent className="space-y-3 text-xs text-muted-foreground"><p>Next agent: <span className="text-foreground">{session.next_agent || '—'}</span></p><p>Iteration: <span className="text-foreground">{session.iteration_count ?? '—'}</span></p><p>Thread: <span className="font-mono text-[10px] text-foreground">{session.thread_id}</span></p></CardContent></Card></aside></div></Tabs></div>

  return <SidebarProvider><AppSidebar /><SidebarInset><DashboardNavbar /><main className="min-h-[calc(100vh-3.5rem)] flex-1 bg-background p-4 text-foreground sm:p-6 lg:p-8">{mode === 'new' && <NewArchitecture onStart={startNew} onOpen={openExisting} />}{mode === 'live' && <>{isLoading ? <div className="mx-auto max-w-6xl space-y-5 py-5"><Skeleton className="h-40" /><Skeleton className="h-96" /></div> : <LiveRun requirement={requirement} threadId={threadId} status={runStatus} events={events} metrics={metrics} onResume={resume} onCheckState={() => void checkCurrentState()} isChecking={isCheckingState} recoveryMessage={loadError} />}{loadError && !isLoading && <div className="mx-auto mt-4 flex max-w-6xl items-center justify-between gap-3 border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"><span>{loadError}</span><Button size="sm" variant="outline" onClick={() => { setMode('new'); setLoadError(null) }}>Start new</Button></div>}</>}{mode === 'workspace' && workspace}</main><Dialog open={Boolean(selectedDiagram)} onOpenChange={(open) => { if (!open) setSelectedDiagram(null) }}><DialogContent className="max-w-4xl p-0 sm:max-w-4xl"><DialogHeader className="border-b border-border p-4 pr-12"><DialogTitle>{selectedDiagram?.name || 'Diagram preview'}</DialogTitle><DialogDescription>{selectedDiagram?.component_slug || 'System'} · iteration {selectedDiagram?.iteration ?? '—'}</DialogDescription></DialogHeader>{selectedDiagram && <div className="space-y-3 p-4"><div className="max-h-[65vh] overflow-auto bg-muted/40"><img src={selectedDiagram.url} alt={selectedDiagram.name} className="mx-auto max-h-[65vh] object-contain" /></div><div className="flex justify-end gap-2"><CopyButton value={selectedDiagram.url} label="Copy link" /><Button size="sm" variant="outline" render={<a href={selectedDiagram.url} target="_blank" rel="noreferrer" />}><ArrowSquareOut />Open in new tab</Button></div></div>}</DialogContent></Dialog></SidebarInset></SidebarProvider>
}

function HealthRow({ label, value, good = false }: Readonly<{ label: string; value: string; good?: boolean }>) { return <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">{label}</span><span className={cn('capitalize', good ? 'text-emerald-700 dark:text-emerald-400' : 'text-foreground')}>{value}</span></div> }

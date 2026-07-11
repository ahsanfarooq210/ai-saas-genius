import { ArrowRight, FolderPlus, Sparkle } from '@phosphor-icons/react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { DashboardShell } from '@/screens/dashboard/DashboardShell'

export function NewProjectScreen() {
  return (
    <DashboardShell>
      <div className="mx-auto max-w-3xl space-y-6 py-8"><section className="text-center"><div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary"><FolderPlus className="size-6" /></div><Badge variant="outline" className="mt-4">Project setup</Badge><h1 className="mt-3 text-3xl font-semibold tracking-tight">Create a project space</h1><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Give the architecture work a clear home before adding the detailed system requirement.</p></section><Card><CardHeader className="border-b border-border"><CardTitle>Project details</CardTitle><CardDescription>These fields are visual placeholders and do not create a project yet.</CardDescription></CardHeader><CardContent className="space-y-5 pt-5"><label className="block space-y-2 text-xs font-medium">Project name<Input readOnly placeholder="e.g. Partner API platform" /></label><label className="block space-y-2 text-xs font-medium">Owner or team<Input readOnly placeholder="e.g. Platform engineering" /></label><div className="flex justify-end gap-2 border-t border-border pt-4"><Link to="/dashboard/projects"><Button variant="outline">Cancel</Button></Link><Link to="/dashboard/new"><Button><Sparkle />Continue to architecture <ArrowRight /></Button></Link></div></CardContent></Card></div>
    </DashboardShell>
  )
}

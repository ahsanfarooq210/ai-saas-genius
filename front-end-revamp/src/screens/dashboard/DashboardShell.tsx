import type { ReactNode } from 'react'

import { AppSidebar } from '@/components/dashboard/app-sidebar'
import { DashboardNavbar } from '@/components/dashboard/dashboard-navbar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'

interface DashboardShellProps {
  readonly children: ReactNode
}

export function DashboardShell({ children }: DashboardShellProps) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <DashboardNavbar />
        <main className="min-h-[calc(100vh-3.5rem)] bg-background p-4 text-foreground sm:p-6 lg:p-8">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

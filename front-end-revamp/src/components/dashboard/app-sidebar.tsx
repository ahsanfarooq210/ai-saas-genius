import {
  Gauge,
  Plus,
  Sparkle,
  Stack,
} from '@phosphor-icons/react'
import { NavLink, useLocation } from 'react-router-dom'

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'

const navItems = [
  { title: 'Overview', icon: Gauge, href: '/dashboard', exact: true },
  { title: 'New architecture', icon: Plus, href: '/dashboard/new', exact: true },
  { title: 'Projects', icon: Stack, href: '/dashboard/projects', exact: false },
]

export function AppSidebar() {
  const { pathname } = useLocation()

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<NavLink to="/dashboard" />}>
              <div className="flex size-6 items-center justify-center rounded-none bg-primary text-primary-foreground">
                <Sparkle weight="fill" className="size-3.5" />
              </div>
              <span className="text-sm font-semibold">Front End Revamp</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    isActive={item.exact ? pathname === item.href : pathname.startsWith(item.href)}
                    tooltip={item.title}
                    render={<NavLink to={item.href} />}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}

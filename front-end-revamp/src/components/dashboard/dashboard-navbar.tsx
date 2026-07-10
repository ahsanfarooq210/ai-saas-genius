import { CaretDown, SignOut } from '@phosphor-icons/react'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { ThemeToggle } from '@/components/theme-toggle'
import { useAuth } from '@/features/auth/auth-context'

function initialsFromEmail(email?: string) {
  if (!email) return '?'
  return email.slice(0, 2).toUpperCase()
}

export function DashboardNavbar() {
  const { user, logout } = useAuth()

  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-4">
      <SidebarTrigger />
      <Separator orientation="vertical" className="mr-2 h-4" />
      <h2 className="text-sm font-medium text-foreground">Dashboard</h2>

      <div className="ml-auto flex items-center gap-2">
        <ThemeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" className="gap-2 px-2">
                <Avatar size="sm">
                  <AvatarFallback>
                    {initialsFromEmail(user?.email)}
                  </AvatarFallback>
                </Avatar>
                <span className="max-w-40 truncate text-xs">
                  {user?.email}
                </span>
                <CaretDown className="size-3.5 text-muted-foreground" />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>My Account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void logout()}>
              <SignOut />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}

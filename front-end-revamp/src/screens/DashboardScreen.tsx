import { ArrowRight, CheckCircle, Sparkle, Stack } from '@phosphor-icons/react'

import { AppSidebar } from '@/components/dashboard/app-sidebar'
import { DashboardNavbar } from '@/components/dashboard/dashboard-navbar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/features/auth/auth-context'

export function DashboardScreen() {
  const { user, logout } = useAuth()

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <DashboardNavbar />
        <main className="flex-1 p-6 text-foreground md:p-10">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
            <section className="flex flex-col gap-5 border border-border bg-card p-5 shadow-sm md:flex-row md:items-center md:justify-between">
              <div className="space-y-3">
                <Badge variant="outline" className="gap-1">
                  <Sparkle weight="fill" />
                  shadcn/ui + Tailwind smoke test
                </Badge>
                <div className="space-y-2">
                  <h1 className="text-2xl font-semibold tracking-normal md:text-4xl">
                    Component styling is live.
                  </h1>
                  <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                    Signed in as {user?.email}.
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => void logout()}>
                  Log out
                </Button>
                <Button>
                  Primary
                  <ArrowRight />
                </Button>
              </div>
            </section>

            <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
              <Card>
                <CardHeader>
                  <CardTitle>Project Controls</CardTitle>
                  <CardDescription>
                    A compact form to verify inputs, labels, switches, tabs, and
                    focus rings.
                  </CardDescription>
                  <CardAction>
                    <Badge>Ready</Badge>
                  </CardAction>
                </CardHeader>
                <CardContent className="space-y-5">
                  <Tabs defaultValue="preview">
                    <TabsList>
                      <TabsTrigger value="preview">Preview</TabsTrigger>
                      <TabsTrigger value="settings">Settings</TabsTrigger>
                      <TabsTrigger value="deploy">Deploy</TabsTrigger>
                    </TabsList>
                    <TabsContent value="preview" className="mt-4 space-y-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="project-name">Project name</Label>
                          <Input id="project-name" defaultValue="Front End Revamp" />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="status">Status</Label>
                          <Input id="status" defaultValue="Tailwind connected" />
                        </div>
                      </div>
                      <div className="flex items-center justify-between border border-border p-3">
                        <div className="space-y-1">
                          <p className="text-sm font-medium">Use shadcn theme</p>
                          <p className="text-xs text-muted-foreground">
                            Toggle uses Base UI state attributes and token colors.
                          </p>
                        </div>
                        <Switch defaultChecked />
                      </div>
                    </TabsContent>
                    <TabsContent value="settings" className="mt-4">
                      <div className="grid gap-3 sm:grid-cols-3">
                        {['bg-background', 'text-foreground', 'border-border'].map(
                          (token) => (
                            <div key={token} className="border border-border p-3">
                              <p className="text-xs text-muted-foreground">
                                Token
                              </p>
                              <p className="mt-1 text-sm font-medium">{token}</p>
                            </div>
                          )
                        )}
                      </div>
                    </TabsContent>
                    <TabsContent value="deploy" className="mt-4">
                      <div className="flex items-start gap-3 border border-border p-3">
                        <CheckCircle className="mt-0.5 size-4 text-primary" />
                        <div>
                          <p className="text-sm font-medium">Build-ready layout</p>
                          <p className="text-xs leading-5 text-muted-foreground">
                            If this renders with spacing, borders, typography, and
                            hover states, Tailwind and shadcn styles are wired.
                          </p>
                        </div>
                      </div>
                    </TabsContent>
                  </Tabs>
                </CardContent>
                <CardFooter className="justify-between">
                  <span className="text-xs text-muted-foreground">
                    Responsive at mobile and desktop widths
                  </span>
                  <Button size="sm" variant="secondary">
                    Save demo
                  </Button>
                </CardFooter>
              </Card>

              <div className="grid gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Install Check</CardTitle>
                    <CardDescription>
                      Utility classes and component slots in one place.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="flex size-10 items-center justify-center border border-border bg-muted">
                        <Stack className="size-5" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">Tailwind utilities</p>
                        <p className="text-xs text-muted-foreground">
                          Grid, spacing, colors, and responsive classes
                        </p>
                      </div>
                    </div>
                    <Separator />
                    <Progress value={72}>
                      <ProgressLabel>Theme coverage</ProgressLabel>
                      <ProgressValue />
                    </Progress>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Badges</CardTitle>
                    <CardDescription>
                      Variants should inherit tokenized colors.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-2">
                    <Badge>Default</Badge>
                    <Badge variant="secondary">Secondary</Badge>
                    <Badge variant="outline">Outline</Badge>
                    <Badge variant="destructive">Destructive</Badge>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  ChevronRight,
  Code,
  Crown,
  Gauge,
  ImageIcon,
  LayoutDashboard,
  MessageSquare,
  Music,
  Settings,
  Sparkles,
  VideoIcon,
  WandSparkles,
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";

const routes = [
  {
    label: "Dashboard",
    icon: LayoutDashboard,
    href: "/dashboard",
    color: "text-sky-500",
  },
  {
    label: "Conversation",
    icon: MessageSquare,
    href: "/conversation",
    color: "text-violet-500",
  },
  {
    label: "Image Generation",
    icon: ImageIcon,
    href: "/image",
    color: "text-pink-700",
  },
  {
    label: "Video Generation",
    icon: VideoIcon,
    href: "/video",
    color: "text-orange-700",
  },
  {
    label: "Music Generation",
    icon: Music,
    href: "/music",
    color: "text-emerald-500",
  },
  {
    label: "Code Generation",
    icon: Code,
    href: "/code",
    color: "text-green-700",
  },
  {
    label: "Settings",
    icon: Settings,
    href: "/settings",
  },
];

const workspaceHighlights = [
  {
    label: "Creative flow",
    value: "Unified",
  },
  {
    label: "Assistant mode",
    value: "Ready",
  },
];

interface SidebarProps {
  apiLimitCount?: number;
  isPro?: boolean;
}

const Sidebar = ({ apiLimitCount = 0, isPro = false }: SidebarProps) => {
  const location = useLocation();
  const pathname = location.pathname;
  const maxFreeCounts = 5;
  const usageValue = Math.min((apiLimitCount / maxFreeCounts) * 100, 100);
  const usageLabel = isPro
    ? "Unlimited access enabled"
    : `${apiLimitCount}/${maxFreeCounts} free requests used`;

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden border-r border-sidebar-border/80 bg-sidebar text-sidebar-foreground">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden p-4">
        <Card className="overflow-hidden border-sidebar-border/80 bg-linear-to-br from-sidebar via-sidebar to-sidebar-accent/15 py-0 shadow-2xl shadow-black/8">
          <CardHeader className="gap-4 border-b border-sidebar-border/70 px-4 py-4">
            <Link
              to="/dashboard"
              className="flex items-center gap-3 rounded-2xl border border-sidebar-border/70 bg-sidebar/80 p-3 transition-all hover:bg-sidebar/95 hover:shadow-lg hover:shadow-black/5"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sidebar-primary text-sidebar-primary-foreground shadow-lg shadow-sidebar-primary/20">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                {/* <img alt="Logo" src="/logo.png" /> */}
                {/* Replace with actual logo or text */}
                <p className="text-lg font-semibold tracking-tight text-sidebar-foreground">
                  Genius
                </p>
                <p className="text-xs text-sidebar-foreground/70">
                  AI creative workspace
                </p>
              </div>
              <Badge
                variant={isPro ? "default" : "secondary"}
                className={cn(
                  "border-0 px-2.5 py-0.5",
                  isPro
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "bg-secondary text-secondary-foreground",
                )}
              >
                {isPro ? "Pro" : "Free"}
              </Badge>
            </Link>

            <div className="rounded-2xl border border-sidebar-border/70 bg-sidebar/70 p-3">
              <div className="flex items-center gap-3">
                <Avatar size="lg" className="ring-2 ring-sidebar-border/80">
                  <AvatarFallback className="bg-sidebar-primary/15 font-semibold text-sidebar-primary">
                    AG
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-sidebar-foreground">
                    Creative workspace
                  </p>
                  <p className="text-xs text-sidebar-foreground/70">
                    Curated tools for writing, visuals, audio, and code
                  </p>
                </div>
              </div>

              <div className="mt-4 grid gap-2 grid-cols-1">
                {workspaceHighlights.map((item) => (
                  <div
                    key={item.label}
                    className="rounded-xl border border-sidebar-border/60 bg-sidebar/90 px-3 py-2"
                  >
                    <p className="text-[11px] uppercase tracking-[0.18em] text-sidebar-foreground/55">
                      {item.label}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-sidebar-foreground">
                      {item.value}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-4 p-4">
            <div className="flex items-center justify-between px-1">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sidebar-foreground/55">
                  Navigation
                </p>
                <p className="mt-1 text-sm text-sidebar-foreground/70">
                  Move through your AI workspaces
                </p>
              </div>
              <Badge
                variant="outline"
                className="border-sidebar-border/70 bg-sidebar/80 text-sidebar-foreground/80"
              >
                {routes.length} items
              </Badge>
            </div>

            <div className="max-h-[40vh] space-y-2 overflow-y-auto pr-1">
              {routes.map((route) => {
                const isActive = pathname === route.href;

                return (
                  <Link
                    key={route.href}
                    to={route.href}
                    className={cn(
                      "group flex items-center gap-3 rounded-2xl border px-3 py-3 transition-all duration-200",
                      isActive
                        ? "border-sidebar-primary/30 bg-sidebar-primary text-sidebar-primary-foreground shadow-lg shadow-sidebar-primary/15"
                        : "border-transparent bg-transparent text-sidebar-foreground/80 hover:border-sidebar-border/70 hover:bg-sidebar/80 hover:text-sidebar-foreground",
                    )}
                  >
                    <div
                      className={cn(
                        "flex h-10 w-10 items-center justify-center rounded-xl border transition-all",
                        isActive
                          ? "border-sidebar-primary-foreground/15 bg-sidebar-primary-foreground/12 text-sidebar-primary-foreground"
                          : "border-sidebar-border/70 bg-sidebar/90",
                      )}
                    >
                      <route.icon
                        className={cn(
                          "h-4 w-4 transition-colors",
                          isActive
                            ? "text-sidebar-primary-foreground"
                            : (route.color ?? "text-sidebar-foreground/80"),
                        )}
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {route.label}
                      </p>
                      <p
                        className={cn(
                          "text-xs",
                          isActive
                            ? "text-sidebar-primary-foreground/80"
                            : "text-sidebar-foreground/55",
                        )}
                      >
                        {route.href.replace("/", "")} workspace
                      </p>
                    </div>

                    <ChevronRight
                      className={cn(
                        "h-4 w-4 transition-all duration-200",
                        isActive
                          ? "translate-x-0 text-sidebar-primary-foreground/90"
                          : "text-sidebar-foreground/35 group-hover:translate-x-0.5 group-hover:text-sidebar-foreground/70",
                      )}
                    />
                  </Link>
                );
              })}
            </div>

            <Separator className="bg-sidebar-border/70" />

            <div className="grid grid-cols-1 gap-3">
              <div className="rounded-2xl border border-sidebar-border/70 bg-sidebar/75 p-3">
                <div className="flex items-center gap-2 text-sidebar-foreground/70">
                  <Gauge className="h-4 w-4 text-sidebar-primary" />
                  <span className="text-xs font-medium uppercase tracking-[0.18em]">
                    Focus
                  </span>
                </div>
                <p className="mt-3 text-lg font-semibold text-sidebar-foreground">
                  Streamlined
                </p>
              </div>
              <div className="rounded-2xl border border-sidebar-border/70 bg-sidebar/75 p-3">
                <div className="flex items-center gap-2 text-sidebar-foreground/70">
                  <WandSparkles className="h-4 w-4 text-sidebar-primary" />
                  <span className="text-xs font-medium uppercase tracking-[0.18em]">
                    Style
                  </span>
                </div>
                <p className="mt-3 text-lg font-semibold text-sidebar-foreground">
                  Themed
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="mt-auto max-h-[38vh] overflow-hidden border-sidebar-border/80 bg-linear-to-br from-sidebar via-sidebar to-sidebar-primary/10 py-0 shadow-xl shadow-black/8">
          <CardContent className="space-y-3 overflow-y-auto p-4 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-sidebar-border/70">
            <div className="rounded-2xl border border-sidebar-border/70 bg-sidebar/75 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-sidebar-foreground">
                    Usage overview
                  </p>
                  <p className="mt-1 text-xs text-sidebar-foreground/70">
                    {usageLabel}
                  </p>
                </div>
                <Badge
                  variant={isPro ? "default" : "outline"}
                  className={cn(
                    "shrink-0 border-sidebar-border/70",
                    isPro
                      ? "bg-sidebar-primary text-sidebar-primary-foreground"
                      : "bg-sidebar/90 text-sidebar-foreground",
                  )}
                >
                  {isPro ? "Unlimited" : "Starter"}
                </Badge>
              </div>
            </div>

            <div className="rounded-2xl border border-sidebar-border/70 bg-sidebar/75 p-3">
              <div className="mb-2 flex items-center justify-between gap-2 text-xs text-sidebar-foreground/70">
                <span>Workspace credits</span>
                <span className="font-semibold text-sidebar-foreground/85">
                  {isPro ? "100%" : `${Math.round(usageValue)}%`}
                </span>
              </div>
              <Progress value={isPro ? 100 : usageValue} className="gap-0" />
              <p className="mt-2 text-[11px] text-sidebar-foreground/60">
                {isPro
                  ? "Your workspace has full access."
                  : "Upgrade for unlimited requests."}
              </p>
            </div>

            <div className="rounded-2xl border border-sidebar-border/70 bg-sidebar/75 p-3">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sidebar-primary/12 text-sidebar-primary">
                  <Crown className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-sidebar-foreground">
                    {isPro ? "Pro plan active" : "Unlock Pro features"}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-sidebar-foreground/70">
                    {isPro
                      ? "Manage your plan and keep your creative workflow fully unlocked."
                      : "Get more requests and a smoother workflow across every AI tool."}
                  </p>
                </div>
              </div>

              <Link
                to="/settings"
                className={cn(
                  buttonVariants({
                    variant: isPro ? "secondary" : "default",
                    size: "lg",
                  }),
                  "mt-4 w-full justify-between rounded-xl",
                )}
              >
                <span>{isPro ? "Manage subscription" : "Upgrade to Pro"}</span>
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
      {/* FreeCounter component could be added here */}
    </div>
  );
};

export default Sidebar;

import {
  ArrowRight,
  Bot,
  Clock3,
  Code,
  ImageIcon,
  MessageSquare,
  Music,
  Sparkles,
  VideoIcon,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

const tools = [
  {
    label: "Conversation",
    icon: MessageSquare,
    color: "text-violet-500",
    bgColor: "bg-violet-500/10",
    borderColor: "border-violet-500/20",
    accent: "from-violet-500/20 via-transparent to-transparent",
    description: "Brainstorm ideas, draft content, and get instant answers.",
    badge: "Most used",
    features: ["Smart replies", "Long-form help"],
    href: "/conversation",
  },
  {
    label: "Music Generation",
    icon: Music,
    color: "text-emerald-500",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/20",
    accent: "from-emerald-500/20 via-transparent to-transparent",
    description: "Create mood-based tracks and audio concepts in seconds.",
    badge: "Creative",
    features: ["Custom vibes", "Fast ideation"],
    href: "/music",
  },
  {
    label: "Image Generation",
    icon: ImageIcon,
    color: "text-pink-700",
    bgColor: "bg-pink-700/10",
    borderColor: "border-pink-700/20",
    accent: "from-pink-700/20 via-transparent to-transparent",
    description: "Turn prompts into polished visuals for products and campaigns.",
    badge: "Visual",
    features: ["Prompt to art", "Brand concepts"],
    href: "/image",
  },
  {
    label: "Video Generation",
    icon: VideoIcon,
    color: "text-orange-700",
    bgColor: "bg-orange-700/10",
    borderColor: "border-orange-700/20",
    accent: "from-orange-700/20 via-transparent to-transparent",
    description: "Generate video-ready ideas and creative assets with ease.",
    badge: "Dynamic",
    features: ["Scene ideas", "Quick concepts"],
    href: "/video",
  },
  {
    label: "Code Generation",
    icon: Code,
    color: "text-green-700",
    bgColor: "bg-green-700/10",
    borderColor: "border-green-700/20",
    accent: "from-green-700/20 via-transparent to-transparent",
    description: "Prototype features, debug faster, and ship ideas confidently.",
    badge: "Builder",
    features: ["Code help", "Rapid iteration"],
    href: "/code",
  },
];

const stats = [
  {
    label: "AI tools",
    value: `${tools.length}+`,
    icon: Bot,
  },
  {
    label: "Always ready",
    value: "24/7",
    icon: Clock3,
  },
  {
    label: "Faster workflows",
    value: "Instant",
    icon: Zap,
  },
];

const DashboardPage = () => {
  const navigate = useNavigate();

  const handleNavigate = (href: string) => {
    navigate(href);
  };

  return (
    <div className="pb-10 text-foreground">
      <div className="px-4 pt-8 md:px-8 lg:px-12">
        <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-linear-to-br from-background via-muted/30 to-background shadow-2xl shadow-black/5">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(139,92,246,0.16),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(34,197,94,0.12),transparent_28%)]" />
          <div className="relative grid gap-8 px-6 py-8 md:px-10 md:py-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
            <div className="space-y-6">
              <Badge variant="secondary" className="border-0 bg-primary/10 text-primary">
                <Sparkles className="mr-1 h-3.5 w-3.5" />
                AI workspace
              </Badge>
              <div className="space-y-3">
                <h2 className="max-w-2xl text-3xl font-extrabold tracking-tight md:text-5xl">
                  Create, explore, and ship with AI from one dashboard
                </h2>
                <p className="max-w-2xl text-sm font-light text-muted-foreground md:text-base">
                  Jump into conversations, generate visuals, compose music, build
                  code, and experiment with ideas through a cleaner, faster
                  creative workspace.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <div className="rounded-full border border-border/60 bg-background/80 px-4 py-2 text-sm text-muted-foreground shadow-sm backdrop-blur-sm">
                  All tools in one place
                </div>
                <div className="rounded-full border border-border/60 bg-background/80 px-4 py-2 text-sm text-muted-foreground shadow-sm backdrop-blur-sm">
                  Designed for speed
                </div>
                <div className="rounded-full border border-border/60 bg-background/80 px-4 py-2 text-sm text-muted-foreground shadow-sm backdrop-blur-sm">
                  Ready for your next idea
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              {stats.map((stat) => (
                <Card
                  key={stat.label}
                  className="border-border/60 bg-background/80 py-0 shadow-lg shadow-black/5 backdrop-blur-sm"
                >
                  <CardContent className="flex items-center gap-4 p-5">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                      <stat.icon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold tracking-tight">{stat.value}</p>
                      <p className="text-sm text-muted-foreground">{stat.label}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 pt-8 md:px-8 lg:px-12">
        <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-primary/80">
              Explore tools
            </p>
            <h3 className="text-2xl font-bold tracking-tight md:text-3xl">
              Pick a workspace and start creating
            </h3>
            <p className="max-w-2xl text-sm text-muted-foreground md:text-base">
              Each experience is tailored for a different part of your workflow,
              from brainstorming to production-ready outputs.
            </p>
          </div>
          <Badge variant="outline" className="w-fit border-border/60 px-3 py-1 text-muted-foreground">
            {tools.length} creative tools available
          </Badge>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {tools.map((tool) => (
            <Card
              key={tool.href}
              role="button"
              tabIndex={0}
              onClick={() => handleNavigate(tool.href)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  handleNavigate(tool.href);
                }
              }}
              className={cn(
                "group relative cursor-pointer border bg-card/80 py-0 text-card-foreground shadow-lg shadow-black/5 transition-all duration-300 hover:-translate-y-1.5 hover:shadow-2xl hover:shadow-black/10",
                tool.borderColor,
              )}
            >
              <div
                className={cn(
                  "absolute inset-0 bg-linear-to-br opacity-0 transition-opacity duration-300 group-hover:opacity-100",
                  tool.accent,
                )}
              />
              <div className="relative">
                <CardHeader className="space-y-4 p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className={cn("rounded-2xl p-3 shadow-sm", tool.bgColor)}>
                      <tool.icon className={cn("h-7 w-7", tool.color)} />
                    </div>
                    <Badge variant="outline" className="border-border/60 bg-background/70 text-muted-foreground">
                      {tool.badge}
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    <CardTitle className="text-xl font-bold">{tool.label}</CardTitle>
                    <CardDescription className="text-sm leading-6">
                      {tool.description}
                    </CardDescription>
                  </div>
                </CardHeader>

                <CardContent className="space-y-5 px-6 pb-6">
                  <div className="flex flex-wrap gap-2">
                    {tool.features.map((feature) => (
                      <span
                        key={feature}
                        className="rounded-full border border-border/60 bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground"
                      >
                        {feature}
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center justify-between border-t border-border/60 pt-4">
                    <span className="text-sm font-medium text-foreground/80">
                      Open workspace
                    </span>
                    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border/60 bg-background/80 transition-transform duration-300 group-hover:translate-x-1">
                      <ArrowRight className="h-4 w-4 text-muted-foreground transition group-hover:text-foreground" />
                    </div>
                  </div>
                </CardContent>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;

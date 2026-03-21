import { Link } from "react-router-dom";
import { ArrowRight, Bot, Sparkles, WandSparkles, Zap } from "lucide-react";
import TypewriterComponent from "typewriter-effect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";

const stats = [
  {
    label: "Creative tools",
    value: "5+",
    icon: Bot,
  },
  {
    label: "Faster output",
    value: "10x",
    icon: Zap,
  },
  {
    label: "Built for ideas",
    value: "24/7",
    icon: WandSparkles,
  },
];

const LandingHero = () => {
  const { user } = useAuth();

  return (
    <section className="relative overflow-hidden px-4 pb-16 pt-10 md:px-6 md:pb-24 md:pt-12">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(217,119,6,0.12),transparent_24%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.10),transparent_22%)]" />
      <div className="relative mx-auto max-w-7xl">
        <div className="grid items-center gap-10 lg:grid-cols-[1.08fr_0.92fr]">
          <div className="space-y-8 text-center lg:text-left">
            <div className="space-y-5">
              <Badge
                variant="secondary"
                className="border-0 bg-primary/10 px-4 py-1.5 text-primary"
              >
                <Sparkles className="mr-1 h-3.5 w-3.5" />
                The AI workspace for modern creators
              </Badge>

              <div className="space-y-4">
                <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl md:text-6xl lg:text-7xl">
                  Create faster with AI built for
                </h1>
                <div className="min-h-16 text-4xl font-extrabold tracking-tight text-transparent bg-linear-to-r from-primary via-chart-3 to-chart-2 bg-clip-text sm:min-h-19 sm:text-5xl md:min-h-22 md:text-6xl lg:min-h-26 lg:text-7xl">
                  <TypewriterComponent
                    options={{
                      strings: [
                        "Chatbot.",
                        "Photo Generation.",
                        "Music Generation.",
                        "Code Generation.",
                        "Video Generation.",
                      ],
                      autoStart: true,
                      loop: true,
                    }}
                  />
                </div>
              </div>

              <p className="mx-auto max-w-2xl text-sm leading-7 text-muted-foreground md:text-lg lg:mx-0">
                Write, design, prototype, and experiment from one polished
                workspace. Turn prompts into production-ready output with a
                cleaner, faster AI experience.
              </p>
            </div>

            <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
              <Link to={user ? "/swarm" : "/sign-up"}>
                <Button className="h-12 rounded-full px-6 text-sm font-semibold shadow-lg shadow-primary/20 md:h-13 md:px-7 md:text-base">
                  {user ? "Open Swarm" : "Start Generating For Free"}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              {!user && (
                <Link to="/sign-in">
                  <Button
                    variant="outline"
                    className="h-12 rounded-full border-border/70 bg-background/80 px-6 text-sm font-semibold md:h-13 md:px-7 md:text-base"
                  >
                    Sign In
                  </Button>
                </Link>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-muted-foreground sm:text-sm lg:justify-start">
              <div className="rounded-full border border-border/70 bg-background/80 px-4 py-2 shadow-sm">
                No credit card required
              </div>
              <div className="rounded-full border border-border/70 bg-background/80 px-4 py-2 shadow-sm">
                Beautiful light and dark themes
              </div>
              <div className="rounded-full border border-border/70 bg-background/80 px-4 py-2 shadow-sm">
                Built for creators and teams
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            {stats.map((stat) => (
              <Card
                key={stat.label}
                className="border-border/70 bg-background/80 py-0 shadow-lg shadow-black/5 backdrop-blur-sm"
              >
                <CardContent className="flex items-center gap-4 p-5">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <stat.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold tracking-tight text-foreground">
                      {stat.value}
                    </p>
                    <p className="text-sm text-muted-foreground">{stat.label}</p>
                  </div>
                </CardContent>
              </Card>
            ))}

            <Card className="sm:col-span-3 lg:col-span-1 xl:col-span-3 border-border/70 bg-linear-to-br from-card via-background to-muted/50 py-0 shadow-xl shadow-black/5">
              <CardContent className="space-y-4 p-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      One workspace, multiple creative modes
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Move from idea to output without switching tools.
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-3">
                  <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3 text-sm text-muted-foreground">
                    Conversations
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3 text-sm text-muted-foreground">
                    Visual generation
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3 text-sm text-muted-foreground">
                    Code assistance
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </section>
  );
};

export default LandingHero;

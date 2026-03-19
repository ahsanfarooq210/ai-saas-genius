import { Quote, Sparkles, Star } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const testimonials = [
  {
    name: "Joel",
    avatar: "J",
    title: "Software Engineer",
    description: "This is the best application I've used!",
  },
  {
    name: "Antonio",
    avatar: "A",
    title: "Designer",
    description: "I use this daily for generating new photos!",
  },
  {
    name: "Mark",
    avatar: "M",
    title: "CEO",
    description: "This app has changed my life, cannot imagine working without it.",
  },
  {
    name: "Mary",
    avatar: "M",
    title: "CFO",
    description: "The best in class, definitely worth the premium subscription!",
  },
];

const LandingContent = () => {
  return (
    <section className="px-4 pb-24 md:px-6">
      <div className="mx-auto max-w-7xl space-y-10">
        <div className="space-y-4 text-center">
          <Badge
            variant="secondary"
            className="border-0 bg-primary/10 px-4 py-1.5 text-primary"
          >
            <Sparkles className="mr-1 h-3.5 w-3.5" />
            Loved by creators and teams
          </Badge>
          <div className="space-y-3">
            <h2 className="text-3xl font-extrabold tracking-tight text-foreground md:text-5xl">
              Trusted by people building faster with AI
            </h2>
            <p className="mx-auto max-w-3xl text-sm leading-7 text-muted-foreground md:text-base">
              From solo makers to growing teams, Genius helps people move from
              idea to output with a smoother, more focused creative workflow.
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {testimonials.map((item) => (
            <Card
              key={item.description}
              className="group border-border/70 bg-background/80 py-0 shadow-lg shadow-black/5 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-black/8"
            >
              <CardHeader className="space-y-4 p-6">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Avatar size="lg" className="ring-2 ring-border/70">
                      <AvatarFallback className="bg-primary/12 font-semibold text-primary">
                        {item.avatar}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <CardTitle className="text-lg font-semibold text-foreground">
                        {item.name}
                      </CardTitle>
                      <CardDescription className="text-sm">
                        {item.title}
                      </CardDescription>
                    </div>
                  </div>

                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Quote className="h-4 w-4" />
                  </div>
                </div>

                <div className="flex items-center gap-1 text-primary">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <Star key={`${item.name}-${index}`} className="h-4 w-4 fill-current" />
                  ))}
                </div>
              </CardHeader>

              <CardContent className="px-6 pb-6">
                <p className="text-sm leading-7 text-foreground/80">
                  {item.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="rounded-[28px] border border-border/70 bg-linear-to-br from-card via-background to-muted/50 p-6 shadow-xl shadow-black/5 md:p-8">
          <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
            <div className="space-y-2">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary/80">
                Start today
              </p>
              <h3 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">
                Build with a cleaner, faster AI workflow
              </h3>
              <p className="max-w-2xl text-sm leading-7 text-muted-foreground">
                Explore the dashboard, switch between tools, and experience a more
                polished creative workspace from your very first prompt.
              </p>
            </div>

            <Badge
              variant="outline"
              className="w-fit border-border/70 bg-background/80 px-4 py-2 text-sm text-muted-foreground"
            >
              Ready for your next idea
            </Badge>
          </div>
        </div>
      </div>
    </section>
  );
};

export default LandingContent;

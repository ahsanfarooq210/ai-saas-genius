import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

const LandingNavbar = () => {
  const { user } = useAuth();

  return (
    <nav className="sticky top-0 z-50 px-4 pt-4 md:px-6">
      <div className="mx-auto flex max-w-7xl items-center justify-between rounded-[24px] border border-border/70 bg-background/75 px-4 py-3 shadow-lg shadow-black/5 backdrop-blur-xl md:px-5">
        <Link to="/" className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <p className="text-base font-bold tracking-tight text-foreground md:text-lg">
              Genius
            </p>
            <p className="hidden text-xs text-muted-foreground sm:block">
              AI creative workspace
            </p>
          </div>
        </Link>

        <div className="flex items-center gap-2">
          <Badge
            variant="secondary"
            className="hidden border-0 bg-primary/10 px-3 py-1 text-primary md:inline-flex"
          >
            New themed experience
          </Badge>

          {!user && (
            <Link to="/sign-in" className="hidden sm:block">
              <Button
                variant="ghost"
                className="rounded-full px-4 text-foreground hover:bg-muted"
              >
                Sign In
              </Button>
            </Link>
          )}

          <Link to={user ? "/dashboard" : "/sign-up"}>
            <Button className="rounded-full px-5 text-sm font-semibold shadow-md shadow-primary/20">
              {user ? "Go to Dashboard" : "Get Started"}
            </Button>
          </Link>
        </div>
      </div>
    </nav>
  );
};

export default LandingNavbar;

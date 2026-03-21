import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LogOut, MoonStar, SunMedium } from "lucide-react";
import { useSwarmStore } from "@/features/swarm/store";
import { useTheme } from "next-themes";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export const SwarmTopNav = () => {
  const navigate = useNavigate();
  const connected = useSwarmStore((state) => state.connection.connected);
  const { user, signOut } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDarkMode = mounted && resolvedTheme === "dark";

  const handleThemeToggle = () => {
    setTheme(isDarkMode ? "light" : "dark");
  };

  const handleLogout = async () => {
    await signOut();
    navigate("/sign-in");
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/75 backdrop-blur-xl">
      <div className="flex h-14 items-center justify-between px-5">
        <div className="flex items-center gap-3">
          <Link to="/swarm" className="font-mono text-xl font-semibold tracking-tight text-foreground">
            Swarm
          </Link>
          <span className="rounded-xl border border-border/70 bg-card px-2 py-0.5 text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
            AI Architecture Generator
          </span>
        </div>

        <div className="flex items-center gap-3 text-sm">
          <Link to="/swarm/history" className="text-muted-foreground transition-colors hover:text-foreground">
            Past Sessions
          </Link>
          <div className="flex items-center gap-2 text-muted-foreground">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                connected ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)]" : "bg-muted-foreground/50"
              }`}
            />
            <span>{connected ? "Connected" : "Disconnected"}</span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8 rounded-xl border-border/70 bg-background/80"
            onClick={handleThemeToggle}
            aria-label="Toggle theme"
          >
            {isDarkMode ? <SunMedium className="h-4 w-4" /> : <MoonStar className="h-4 w-4" />}
          </Button>
          {user ? (
            <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-card/70 p-1.5">
              <Avatar size="default" className="h-7 w-7 ring-1 ring-border/70">
                <AvatarFallback className="bg-primary/12 text-xs font-semibold text-primary">
                  {user.name?.charAt(0)?.toUpperCase() || "U"}
                </AvatarFallback>
              </Avatar>
              <div className="hidden min-w-0 max-w-40 sm:block">
                <p className="truncate text-xs font-semibold text-foreground">{user.name || "User"}</p>
                <p className="truncate text-[11px] text-muted-foreground">{user.email || "Signed in"}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-8 rounded-xl border-border/70 bg-background/80 px-3 text-xs"
                onClick={handleLogout}
              >
                <LogOut className="h-3.5 w-3.5" />
                Logout
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
};

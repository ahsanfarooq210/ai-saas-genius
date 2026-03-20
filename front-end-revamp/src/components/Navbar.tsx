import { useEffect, useState } from "react";
import {
  LogOut,
  Menu,
  MoonStar,
  Settings,
  Sparkles,
  SunMedium,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import Sidebar from "./Sidebar";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "next-themes";
import { useNavigate } from "react-router-dom";

const Navbar = () => {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDarkMode = mounted && resolvedTheme === "dark";

  const handleSignOut = async () => {
    await signOut();
    navigate("/sign-in");
  };

  const handleThemeToggle = (checked: boolean) => {
    setTheme(checked ? "dark" : "light");
  };

  return (
    <div className="sticky top-0 z-50 border-b border-border/70 bg-background/75 px-4 py-3 backdrop-blur-xl md:px-6">
      <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-card/75 px-3 py-2 shadow-lg shadow-black/5">
        <Sheet>
          <SheetTrigger
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-foreground transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 outline-none md:hidden"
          >
            <Menu className="h-5 w-5" />
          </SheetTrigger>
          <SheetContent side="left" className="h-screen w-[min(22rem,100vw)] max-w-88 overflow-hidden border-none p-0">
            <Sidebar />
          </SheetContent>
        </Sheet>

        <div className="hidden min-w-0 flex-1 items-center gap-3 md:flex">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight text-foreground">
              Genius Workspace
            </p>
            <p className="truncate text-xs text-muted-foreground">
              AI tools, faster workflows, one beautiful dashboard
            </p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden items-center gap-3 rounded-2xl border border-border/70 bg-background/80 px-3 py-2 shadow-sm sm:flex">
            <div className="flex items-center gap-2 text-muted-foreground">
              <SunMedium className="h-4 w-4" />
              <span className="text-xs font-medium">Light</span>
            </div>
            <Switch
              checked={isDarkMode}
              onCheckedChange={handleThemeToggle}
              aria-label="Toggle theme"
            />
            <div className="flex items-center gap-2 text-muted-foreground">
              <MoonStar className="h-4 w-4" />
              <span className="text-xs font-medium">Dark</span>
            </div>
          </div>

          <Button
            variant="outline"
            size="icon"
            className="rounded-xl border-border/70 bg-background/80 sm:hidden"
            onClick={() => handleThemeToggle(!isDarkMode)}
            aria-label="Toggle theme"
          >
            {isDarkMode ? (
              <SunMedium className="h-4 w-4" />
            ) : (
              <MoonStar className="h-4 w-4" />
            )}
          </Button>

        {user && (
          <div className="flex items-center gap-2 rounded-2xl border border-border/70 bg-background/80 p-1.5 shadow-sm">
            <Avatar size="default" className="ring-2 ring-border/70">
              <AvatarFallback className="bg-primary/12 font-semibold text-primary">
                {user.name?.charAt(0) || "U"}
              </AvatarFallback>
            </Avatar>

            <div className="hidden min-w-0 pr-1 sm:block">
              <p className="truncate text-sm font-semibold text-foreground">
                {user.name}
              </p>
              <div className="flex items-center gap-2">
                <p className="truncate text-xs text-muted-foreground">
                  Welcome back
                </p>
                <Badge variant="secondary" className="border-0 bg-primary/10 text-primary">
                  Active
                </Badge>
              </div>
            </div>

            <Button
              variant="ghost"
              size="icon"
              className="rounded-xl text-foreground hover:bg-muted"
              onClick={() => navigate("/settings")}
            >
              <Settings className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-xl text-foreground hover:bg-destructive/10 hover:text-destructive"
              onClick={handleSignOut}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        )}
        </div>
      </div>
    </div>
  );
};

export default Navbar;

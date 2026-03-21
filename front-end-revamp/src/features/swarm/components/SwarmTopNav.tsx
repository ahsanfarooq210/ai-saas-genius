import { Link } from "react-router-dom";
import { useSwarmStore } from "@/features/swarm/store";

export const SwarmTopNav = () => {
  const connected = useSwarmStore((state) => state.connection.connected);

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/75 backdrop-blur-xl">
      <div className="flex h-14 items-center justify-between px-5">
        <div className="flex items-center gap-3">
          <Link to="/" className="font-mono text-xl font-semibold tracking-tight text-foreground">
            Swarm
          </Link>
          <span className="rounded-xl border border-border/70 bg-card px-2 py-0.5 text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
            AI Architecture Generator
          </span>
        </div>

        <div className="flex items-center gap-5 text-sm">
          <Link to="/history" className="text-muted-foreground transition-colors hover:text-foreground">
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
        </div>
      </div>
    </header>
  );
};

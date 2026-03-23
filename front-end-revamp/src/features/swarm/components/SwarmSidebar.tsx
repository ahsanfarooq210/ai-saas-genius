import { Link, useLocation } from "react-router-dom";
import { useSwarmStore } from "@/features/swarm/store";

const navItems = [
  { label: "New Session", to: "/swarm" },
  { label: "Session History", to: "/swarm/history" },
  { label: "Settings", to: "/swarm/settings" },
];

const statusDot = {
  connected: "bg-emerald-500",
  reconnecting: "bg-amber-400 animate-pulse",
  idle: "bg-muted-foreground/60",
};

export const SwarmSidebar = () => {
  const location = useLocation();
  const threadId = useSwarmStore((state) => state.threadId);
  const currentStage = useSwarmStore((state) => state.currentStage);
  const currentTask = useSwarmStore((state) => state.currentTask);
  const progressMessage = useSwarmStore((state) => state.progressMessage);
  const activeItemType = useSwarmStore((state) => state.activeItemType);
  const activeItemName = useSwarmStore((state) => state.activeItemName);
  const connection = useSwarmStore((state) => state.connection);
  const progressFeed = useSwarmStore((state) => state.progressFeed);

  const connectionState = connection.connected ? "connected" : connection.reconnecting ? "reconnecting" : "idle";

  return (
    <aside className="w-60 shrink-0 border-r border-sidebar-border/70 bg-sidebar px-4 py-5 text-sidebar-foreground">
      <nav className="space-y-1">
        {navItems.map((item) => {
          const active = location.pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`block rounded-sm border px-3 py-2 text-sm transition-all ${
                active
                  ? "border-sidebar-border bg-sidebar-primary/15 text-sidebar-foreground"
                  : "border-transparent text-sidebar-foreground/70 hover:border-sidebar-border/70 hover:bg-sidebar/80 hover:text-sidebar-foreground"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {threadId ? (
        <div className="mt-8 space-y-3 rounded-sm border border-sidebar-border/70 bg-card p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Live Activity</p>
            <span className={`h-2.5 w-2.5 rounded-full ${statusDot[connectionState]}`} />
          </div>

          <div className="space-y-2 text-sm">
            <div>
              <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Stage</p>
              <p className="mt-1 text-foreground/90">{currentStage ?? "Connecting..."}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Status</p>
              <p className="mt-1 text-foreground/90">{progressMessage ?? currentTask ?? "Waiting for updates"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Current Item</p>
              <p className="mt-1 text-foreground/90">
                {activeItemType && activeItemName ? `${activeItemType}: ${activeItemName}` : "No active item"}
              </p>
            </div>
          </div>

          {progressFeed[0]?.message ? (
            <div className="rounded-sm border border-sidebar-border/70 bg-background px-3 py-2">
              <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Latest Progress</p>
              <p className="mt-1 text-sm text-foreground/90">{progressFeed[0].message}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
};

import { Link, useLocation } from "react-router-dom";
import { useSwarmStore } from "@/features/swarm/store";

const navItems = [
  { label: "New Session", to: "/" },
  { label: "Session History", to: "/history" },
  { label: "Settings", to: "/settings" },
];

const statusDot = {
  idle: "bg-muted-foreground/60",
  active: "bg-sky-400 animate-pulse",
  approved: "bg-emerald-500",
  rejected: "bg-destructive",
};

export const SwarmSidebar = () => {
  const location = useLocation();
  const threadId = useSwarmStore((s) => s.threadId);
  const agentStates = useSwarmStore((s) => s.agentStates);

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
        <div className="mt-8 rounded-sm border border-sidebar-border/70 bg-card p-3">
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Live Activity</p>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex items-center justify-between text-foreground/90">
              <span>Architect</span>
              <span className={`h-2.5 w-2.5 rounded-full ${statusDot[agentStates.architect.state]}`} />
            </div>
            <div className="flex items-center justify-between text-foreground/90">
              <span>Scalability Expert</span>
              <span className={`h-2.5 w-2.5 rounded-full ${statusDot[agentStates.scalability.state]}`} />
            </div>
            <div className="flex items-center justify-between text-foreground/90">
              <span>Security Auditor</span>
              <span className={`h-2.5 w-2.5 rounded-full ${statusDot[agentStates.security.state]}`} />
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
};

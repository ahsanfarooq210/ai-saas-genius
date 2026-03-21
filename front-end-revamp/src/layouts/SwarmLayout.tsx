import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { SwarmSidebar } from "@/features/swarm/components/SwarmSidebar";
import { SwarmTopNav } from "@/features/swarm/components/SwarmTopNav";
import { useSwarmStore } from "@/features/swarm/store";

const SwarmLayout = () => {
  const hydrateSettings = useSwarmStore((state) => state.hydrateSettings);
  const hydrateSessionHistory = useSwarmStore((state) => state.hydrateSessionHistory);

  useEffect(() => {
    hydrateSettings();
    hydrateSessionHistory();
  }, [hydrateSessionHistory, hydrateSettings]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SwarmTopNav />
      <div className="flex min-h-[calc(100vh-56px)]">
        <SwarmSidebar />
        <main className="flex-1 p-5 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default SwarmLayout;

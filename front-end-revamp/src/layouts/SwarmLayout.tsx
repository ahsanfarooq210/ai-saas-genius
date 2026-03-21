import { useEffect } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { SwarmSidebar } from "@/features/swarm/components/SwarmSidebar";
import { SwarmTopNav } from "@/features/swarm/components/SwarmTopNav";
import { useSwarmStore } from "@/features/swarm/store";
import { useAuth } from "@/contexts/AuthContext";

const SwarmLayout = () => {
  const { user, isPending } = useAuth();
  const hydrateSettings = useSwarmStore((state) => state.hydrateSettings);
  const hydrateSessionHistory = useSwarmStore((state) => state.hydrateSessionHistory);

  useEffect(() => {
    hydrateSettings();
    hydrateSessionHistory();
  }, [hydrateSessionHistory, hydrateSettings]);

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/sign-in" replace />;
  }

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

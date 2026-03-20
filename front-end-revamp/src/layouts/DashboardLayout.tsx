import Sidebar from "@/components/Sidebar";
import Navbar from "@/components/Navbar";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

const DashboardLayout = () => {
  const { user, isPending } = useAuth();

  if (isPending) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="h-32 w-32 animate-spin rounded-full border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/sign-in" replace />;
  }

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <div className="z-80 hidden h-screen border-r border-sidebar-border bg-sidebar md:fixed md:inset-y-0 md:flex md:w-72 md:flex-col">
        <Sidebar />
      </div>
      <main className="min-h-screen bg-background md:pl-72">
        <Navbar />
        <Outlet />
      </main>
    </div>
  );
};

export default DashboardLayout;

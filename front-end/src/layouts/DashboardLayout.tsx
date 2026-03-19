import Sidebar from "@/components/Sidebar";
import Navbar from "@/components/Navbar";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

const DashboardLayout = () => {
  const { user, isPending } = useAuth();

  if (isPending) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-violet-600"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/sign-in" replace />;
  }

  return (
    <div className="h-full relative bg-slate-50 min-h-screen">
      <div className="hidden h-full md:flex md:w-72 md:flex-col md:fixed md:inset-y-0 bg-slate-900 z-[80]">
        <Sidebar />
      </div>
      <main className="md:pl-72">
        <Navbar />
        <Outlet />
      </main>
    </div>
  );
};

export default DashboardLayout;

import Sidebar from "@/components/Sidebar";
import Navbar from "@/components/Navbar";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

const DashboardLayout = () => {
  const { user, isPending } = useAuth();

  if (isPending) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-[#111827]">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-white"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/sign-in" replace />;
  }

  return (
    <div className="h-full relative">
      <div className="hidden h-full md:flex md:w-72 md:flex-col md:fixed md:inset-y-0 bg-gray-900 z-[80]">
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

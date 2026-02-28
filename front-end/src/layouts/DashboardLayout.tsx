import Sidebar from "@/components/Sidebar";
import Navbar from "@/components/Navbar";
import { Outlet } from "react-router-dom";

const DashboardLayout = () => {
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

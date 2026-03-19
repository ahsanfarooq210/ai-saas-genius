import { Menu, LogOut, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import Sidebar from "@/components/Sidebar";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";

const Navbar = () => {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  const handleSignOut = async () => {
    await signOut();
    navigate("/sign-in");
  };

  return (
    <div className="flex items-center p-4 bg-white/50 backdrop-blur-sm border-b border-slate-200 sticky top-0 z-50">
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="md:hidden text-slate-700">
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="p-0 border-none">
          <Sidebar />
        </SheetContent>
      </Sheet>
      <div className="flex w-full justify-end gap-2 items-center">
        {user && (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-700">{user.name}</span>
            <Button variant="ghost" size="icon" className="text-slate-700" onClick={() => navigate("/settings")}>
              <User className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="text-slate-700" onClick={handleSignOut}>
              <LogOut className="h-4 w-4" />
            </Button>
            <div className="relative h-8 w-8 rounded-full p-0 overflow-hidden border border-slate-200 shadow-sm">
              <div className="h-full w-full bg-violet-100 flex items-center justify-center">
                <span className="text-violet-700 font-semibold">{user.name?.charAt(0) || "U"}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Navbar;

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
    <div className="flex items-center p-4">
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="md:hidden">
            <Menu />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="p-0">
          <Sidebar />
        </SheetContent>
      </Sheet>
      <div className="flex w-full justify-end gap-2 items-center">
        {user && (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{user.name}</span>
            <Button variant="ghost" onClick={() => navigate("/settings")}>
              <User className="h-4 w-4" />
            </Button>
            <Button variant="ghost" onClick={handleSignOut}>
              <LogOut className="h-4 w-4" />
            </Button>
            <div className="relative h-8 w-8 rounded-full p-0 overflow-hidden">
              <div className="h-full w-full bg-slate-200 flex items-center justify-center">
                <span className="text-slate-600 font-semibold">{user.name?.charAt(0) || "U"}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Navbar;

import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import Sidebar from "@/components/Sidebar";
// import { UserButton } from "@clerk/nextjs"; // Replaced with Better Auth User Button

const Navbar = () => {
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
      <div className="flex w-full justify-end">
        {/* <UserButton afterSignOutUrl="/" /> */}
        {/* Implement Better Auth Sign Out / Profile here */}
        <div className="h-8 w-8 rounded-full bg-slate-200"></div>
      </div>
    </div>
  );
};

export default Navbar;

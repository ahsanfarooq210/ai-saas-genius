import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

const LandingNavbar = () => {
  const { user } = useAuth();

  return (
    <nav className="p-4 bg-transparent flex items-center justify-between border-b border-slate-200">
      <Link to="/" className="flex items-center">
        <h1 className="text-2xl font-bold text-slate-900">Genius</h1>
      </Link>
      <div className="flex items-center gap-x-2">
        <Link to={user ? "/dashboard" : "/sign-in"}>
          <Button
            variant="outline"
            className="rounded-full border-slate-300 bg-white text-slate-900 hover:bg-slate-100"
          >
            Get Started
          </Button>
        </Link>
      </div>
    </nav>
  );
};

export default LandingNavbar;

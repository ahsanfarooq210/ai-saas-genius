import { Link } from "react-router-dom";
import { Button } from "./ui/button";
import { useSession } from "@/lib/auth-client";

const LandingNavbar = () => {
  const { data: session } = useSession();

  return (
    <nav className="p-4 bg-transparent flex items-center justify-between">
      <Link to="/" className="flex items-center">
        <h1 className="text-2xl font-bold text-white">Genius</h1>
      </Link>
      <div className="flex items-center gap-x-2">
        <Link to={session ? "/dashboard" : "/sign-in"}>
          <Button variant="outline" className="rounded-full bg-white text-black hover:bg-white/90">
            Get Started
          </Button>
        </Link>
      </div>
    </nav>
  );
};

export default LandingNavbar;

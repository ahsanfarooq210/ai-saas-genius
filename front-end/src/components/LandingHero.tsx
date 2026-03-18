import { Link } from "react-router-dom";
import TypewriterComponent from "typewriter-effect";
import { Button } from "./ui/button";

const LandingHero = () => {
  return (
    <div className="text-slate-900 font-bold py-36 text-center space-y-5">
      <div className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl space-y-5 font-extrabold">
        <h1>The Best AI Tool for</h1>
        <div className="text-transparent bg-clip-text bg-gradient-to-r from-violet-600 to-pink-600">
          <TypewriterComponent
            options={{
              strings: [
                "Chatbot.",
                "Photo Generation.",
                "Music Generation.",
                "Code Generation.",
                "Video Generation.",
              ],
              autoStart: true,
              loop: true,
            }}
          />
        </div>
      </div>
      <div className="text-sm md:text-xl font-light text-slate-500">
        Create content using AI 10x faster.
      </div>
      <div>
        <Link to="/dashboard">
          <Button className="md:text-lg p-4 md:p-6 rounded-full font-semibold bg-violet-600 hover:bg-violet-700 text-white shadow-md">
            Start Generating For Free
          </Button>
        </Link>
      </div>
      <div className="text-slate-500 text-xs md:text-sm font-normal">
        No credit card required.
      </div>
    </div>
  );
};

export default LandingHero;

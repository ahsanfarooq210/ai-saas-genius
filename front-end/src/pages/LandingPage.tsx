import LandingContent from "@/components/LandingContent";
import LandingHero from "@/components/LandingHero";
import LandingNavbar from "@/components/LandingNavbar";

const LandingPage = () => {
  return (
    <main className="h-full bg-slate-50 overflow-auto">
      <div className="mx-auto max-w-screen-xl h-full w-full">
        <LandingNavbar />
        <LandingHero />
        <LandingContent />
      </div>
    </main>
  );
};

export default LandingPage;

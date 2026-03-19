import LandingContent from "@/components/LandingContent";
import LandingHero from "@/components/LandingHero";
import LandingNavbar from "@/components/LandingNavbar";

const LandingPage = () => {
  return (
    <main className="min-h-screen overflow-auto bg-background text-foreground">
      <div className="relative isolate min-h-screen">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(217,119,6,0.10),transparent_26%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.10),transparent_24%),linear-gradient(to_bottom,var(--background),color-mix(in_oklab,var(--background)_75%,var(--muted)_25%),var(--background))]" />
        <div className="mx-auto flex min-h-screen w-full max-w-screen-2xl flex-col">
        <LandingNavbar />
          <div className="flex-1">
            <LandingHero />
            <LandingContent />
          </div>
        </div>
      </div>
    </main>
  );
};

export default LandingPage;

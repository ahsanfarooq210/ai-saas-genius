import LandingContent from "@/components/global/landing-content";
import LandingHero from "@/components/global/landing-hero";
import LandingNavbar from "@/components/global/landing-navbar";
import { Button } from "@/components/ui/button";
import Link from "next/link";

import React from "react";

const LandingPage = () => {
  return (
   <div className="h-full" >
    <LandingNavbar/>
    <LandingHero/>
    <LandingContent/>
   </div>
  );
};

export default LandingPage;

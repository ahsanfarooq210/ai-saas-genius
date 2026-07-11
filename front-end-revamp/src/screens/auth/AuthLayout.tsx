import type { ReactNode } from "react";
import { ChartLineUp, Lightning, ShieldCheck } from "@phosphor-icons/react";

import heroIllustration from "@/assets/hero-illustration.svg";
import logo from "@/assets/logo.svg";
import logoLight from "@/assets/logo-light.svg";

const features = [
  { icon: Lightning, label: "AI architecture plans" },
  { icon: ChartLineUp, label: "Mermaid diagrams and docs" },
  { icon: ShieldCheck, label: "Scale and security reviews" },
];

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen bg-background lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
      <aside className="dark relative hidden min-h-screen flex-col overflow-hidden bg-background px-12 py-10 text-foreground lg:flex xl:px-16">
        <div className="bg-grid-pattern absolute inset-0 opacity-40" />
        <div className="absolute -top-24 -left-32 size-120 rounded-full bg-primary/35 blur-3xl" />
        <div className="absolute right-0 bottom-0 size-96 translate-x-1/3 translate-y-1/3 rounded-full bg-accent/20 blur-3xl" />
        <div className="absolute top-1/2 left-1/2 size-80 -translate-x-1/2 -translate-y-1/2 rounded-full border border-foreground/10" />
        <div className="absolute top-1/2 left-1/2 size-104 -translate-x-1/2 -translate-y-1/2 rounded-full border border-foreground/5" />

        <div className="relative">
          <img src={logoLight} alt="Orbyt" className="h-auto w-28" />
        </div>

        <div className="relative flex flex-1 flex-col items-center justify-center py-10">
          <div className="relative mb-10 flex size-80 items-center justify-center rounded-[2.5rem] border border-foreground/10 bg-foreground/5 shadow-2xl shadow-black/10">
            <div className="absolute inset-5 rounded-4xl border border-foreground/8" />
            <div className="absolute -top-3 right-8 size-6 rounded-full bg-primary shadow-lg shadow-primary/40" />
            <div className="absolute bottom-8 -left-3 size-3 rounded-full bg-accent" />
            <img
              src={heroIllustration}
              alt="Layered system architecture diagram"
              className="relative w-60 max-w-[78%] drop-shadow-2xl"
            />
          </div>
          <div className="max-w-md space-y-4 text-center">
            <span className="inline-flex rounded-full border border-foreground/10 bg-foreground/10 px-3 py-1 text-[10px] font-semibold tracking-[0.16em] text-foreground/80 uppercase">
              AI architecture workspace
            </span>
            <h2 className="text-3xl font-semibold tracking-tight text-balance xl:text-4xl">
              Turn an idea into a production-ready architecture plan.
            </h2>
            <p className="mx-auto max-w-sm text-sm leading-6 text-balance text-foreground/70">
              Describe your system in plain English, then turn the output into
              diagrams, documentation, and reviewable design decisions.
            </p>
          </div>
        </div>

        <div className="relative grid grid-cols-3 gap-3">
          {features.map((feature) => (
            <div
              key={feature.label}
              className="flex min-h-24 flex-col justify-between rounded-xl border border-foreground/10 bg-foreground/5 p-3.5 backdrop-blur-sm"
            >
              <div className="flex size-7 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <feature.icon className="size-4" weight="fill" />
              </div>
              <span className="text-xs leading-4 text-foreground/80">
                {feature.label}
              </span>
            </div>
          ))}
        </div>
      </aside>

      <div className="relative flex items-center justify-center overflow-hidden px-6 py-10 sm:p-10">
        <div className="absolute top-0 right-0 size-72 translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-3xl lg:hidden" />
        <div className="w-full max-w-md">
          <div className="relative mb-8 flex items-center justify-center lg:hidden">
            <img src={logo} alt="Orbyt" className="h-auto w-28 dark:hidden" />
            <img
              src={logoLight}
              alt="Orbyt"
              className="hidden h-auto w-28 dark:block"
            />
          </div>
          <div className="relative">{children}</div>
        </div>
      </div>
    </main>
  );
}

import type { ReactNode } from "react"
import { ChartLineUp, Lightning, ShieldCheck } from "@phosphor-icons/react"

import heroIllustration from "@/assets/hero-illustration.svg"
import logomark from "@/assets/logomark.svg"

const features = [
  { icon: Lightning, label: "Real-time swarm orchestration" },
  { icon: ShieldCheck, label: "Enterprise-grade security" },
  { icon: ChartLineUp, label: "Actionable usage insights" },
]

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen bg-background lg:grid-cols-2">
      <aside className="dark relative hidden flex-col justify-between overflow-hidden bg-background p-10 text-foreground lg:flex">
        <div className="bg-grid-pattern absolute inset-0" />
        <div className="absolute -top-24 -left-24 size-96 rounded-full bg-primary/30 blur-3xl" />
        <div className="absolute -right-16 -bottom-32 size-96 rounded-full bg-secondary/20 blur-3xl" />

        <div className="relative flex items-center gap-2">
          <img src={logomark} alt="" className="size-6" />
          <span className="text-xs font-semibold tracking-[0.2em] text-foreground/80 uppercase">
            Orbyt
          </span>
        </div>

        <div className="relative flex flex-1 flex-col items-center justify-center gap-8 py-10">
          <img
            src={heroIllustration}
            alt=""
            className="w-56 max-w-full drop-shadow-2xl"
          />
          <div className="max-w-sm space-y-3 text-center">
            <h2 className="text-2xl font-semibold text-balance">
              Orchestrate your AI swarm.
            </h2>
            <p className="text-sm leading-6 text-balance text-foreground/70">
              Spin up agents, ship faster, and keep every workflow observable
              from one control plane.
            </p>
          </div>
        </div>

        <div className="relative grid gap-3">
          {features.map((feature) => (
            <div
              key={feature.label}
              className="flex items-center gap-3 rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5"
            >
              <feature.icon className="size-4 text-primary" weight="fill" />
              <span className="text-xs text-foreground/80">
                {feature.label}
              </span>
            </div>
          ))}
        </div>
      </aside>

      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center justify-center gap-2 lg:hidden">
            <img src={logomark} alt="" className="size-6" />
            <span className="text-xs font-semibold tracking-[0.2em] text-foreground/80 uppercase">
              Orbyt
            </span>
          </div>
          {children}
        </div>
      </div>
    </main>
  )
}

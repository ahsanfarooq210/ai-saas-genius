import { Sparkles } from "lucide-react";

const AuthLoadingScreen = () => {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-6 text-foreground">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(217,119,6,0.14),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.14),transparent_26%)]" />
      <div className="absolute left-1/2 top-1/2 h-[26rem] w-[26rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/8 blur-3xl" />

      <div className="relative w-full max-w-md overflow-hidden rounded-[28px] border border-border/70 bg-card/80 p-8 shadow-2xl shadow-black/10 backdrop-blur-xl">
        <div className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />

        <div className="flex flex-col items-center text-center">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
            <Sparkles className="h-7 w-7" />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-primary/80">
              Authenticating
            </p>
            <h1 className="text-2xl font-extrabold tracking-tight">
              Preparing your workspace
            </h1>
            <p className="text-sm leading-6 text-muted-foreground">
              Checking your session and routing you to the right dashboard.
            </p>
          </div>

          <div className="mt-8 flex items-center gap-3 rounded-full border border-border/70 bg-background/80 px-5 py-3 shadow-sm">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
            <span className="text-sm font-medium text-foreground/85">
              One moment
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthLoadingScreen;

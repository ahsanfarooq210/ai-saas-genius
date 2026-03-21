import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { swarmApi } from "@/features/swarm/api";
import { useSwarmStore } from "@/features/swarm/store";

const PLACEHOLDER =
  "Design a globally distributed URL shortener that handles 10,000 requests per second with sub-100ms latency.";

const MAX_CHARS = 1000;

const NewSessionPage = () => {
  const navigate = useNavigate();
  const startSession = useSwarmStore((state) => state.startSession);
  const resetForNewSession = useSwarmStore((state) => state.resetForNewSession);

  const [requirement, setRequirement] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const countLabel = useMemo(() => `${requirement.length}/${MAX_CHARS}`, [requirement.length]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = requirement.trim();
    if (!trimmed) {
      setError("Please add a requirement before launching.");
      return;
    }

    setIsPending(true);
    setError(null);
    resetForNewSession();

    try {
      const response = await swarmApi.start(trimmed);
      startSession(response.thread_id, trimmed);
      navigate(`/session/${response.thread_id}`);
    } catch (submitError: unknown) {
      setError("Failed to start swarm session. Check backend connection and try again.");
      console.error(submitError);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <section className="flex min-h-[70vh] items-center justify-center">
      <form onSubmit={handleSubmit} className="w-full max-w-4xl space-y-6 text-center">
        <div className="space-y-3">
          <h1 className="text-4xl font-semibold tracking-tight text-foreground">Describe your system</h1>
          <p className="text-muted-foreground">
            The swarm will autonomously design, diagram, and critique your architecture.
          </p>
        </div>

        <div className="relative text-left">
          <textarea
            value={requirement}
            onChange={(event) => {
              if (event.target.value.length <= MAX_CHARS) {
                setRequirement(event.target.value);
              }
            }}
            placeholder={PLACEHOLDER}
            className="h-40 w-full resize-none rounded-xl border border-border/70 bg-card p-4 text-sm leading-6 text-foreground outline-none transition-all duration-200 placeholder:text-muted-foreground focus:border-primary focus:shadow-[0_0_0_1px_var(--color-primary)]"
          />
          <span className="absolute right-3 bottom-2 font-mono text-xs text-muted-foreground">{countLabel}</span>
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="inline-flex h-11 min-w-44 items-center justify-center gap-2 rounded-xl border border-primary bg-primary px-6 font-medium text-primary-foreground transition-all duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {isPending ? "Initializing..." : "Launch Swarm"}
        </button>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <p className="text-xs text-muted-foreground">
          The swarm runs up to 5 iterations. Complex architectures may take 2–4 minutes.
        </p>
      </form>
    </section>
  );
};

export default NewSessionPage;

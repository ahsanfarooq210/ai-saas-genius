import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { swarmApi } from "@/features/swarm/api";
import { useSwarmStore } from "@/features/swarm/store";
import type { SessionHistoryItem } from "@/features/swarm/types";

const complexityClass = (score: number | null) => {
  if (score === null) {
    return "border-border text-muted-foreground";
  }
  if (score <= 3) {
    return "border-emerald-500/40 text-emerald-300";
  }
  if (score <= 7) {
    return "border-amber-500/40 text-amber-300";
  }
  return "border-rose-500/40 text-rose-300";
};

const statusClass: Record<SessionHistoryItem["status"], string> = {
  Running: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  Complete: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  Failed: "border-rose-500/40 bg-rose-500/10 text-rose-300",
};

const SessionHistoryPage = () => {
  const navigate = useNavigate();
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const sessionHistory = useSwarmStore((state) => state.sessionHistory);
  const hydrateSessionHistory = useSwarmStore((state) => state.hydrateSessionHistory);
  const hydrateSessionFromHistory = useSwarmStore((state) => state.hydrateSessionFromHistory);
  const setSessionStatus = useSwarmStore((state) => state.setSessionStatus);

  const [items, setItems] = useState<SessionHistoryItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    hydrateSessionHistory();
  }, [hydrateSessionHistory]);

  useEffect(() => {
    setItems(sessionHistory);
  }, [sessionHistory]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || !hasMore) {
          return;
        }
        setPage((current) => current + 1);
      },
      { threshold: 0.8 },
    );

    if (sentinelRef.current) {
      observer.observe(sentinelRef.current);
    }

    return () => observer.disconnect();
  }, [hasMore]);

  useEffect(() => {
    if (page === 1) {
      return;
    }

    let mounted = true;
    const loadMore = async () => {
      const response = await swarmApi.listSessions(page);
      if (!mounted) {
        return;
      }
      if (response.items.length > 0) {
        setItems((current) => {
          const merged = [...current, ...response.items];
          const deduped = Array.from(new Map(merged.map((item) => [item.threadId, item])).values());
          return deduped;
        });
      }
      setHasMore(response.hasMore);
    };

    void loadMore();

    return () => {
      mounted = false;
    };
  }, [page]);

  const ordered = useMemo(
    () => [...items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [items],
  );

  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Session History</h1>
        <p className="mt-1 text-sm text-muted-foreground">Newest sessions first. Scroll to load more.</p>
      </header>

      <div className="overflow-hidden rounded-xl border border-border/70 bg-card">
        <div className="grid grid-cols-[2.2fr_1.2fr_0.8fr_0.8fr_1fr_0.8fr] gap-3 border-b border-border px-4 py-2 text-xs uppercase tracking-[0.12em] text-muted-foreground">
          <span>Requirement</span>
          <span>Created</span>
          <span>Complexity</span>
          <span>Status</span>
          <span>Output</span>
          <span className="text-right">Action</span>
        </div>

        {ordered.map((session) => (
          <div
            key={session.threadId}
            className="grid grid-cols-[2.2fr_1.2fr_0.8fr_0.8fr_1fr_0.8fr] items-center gap-3 border-b border-border px-4 py-3 text-sm text-foreground/90 last:border-b-0"
          >
            <p className="truncate text-foreground">{session.requirement}</p>
            <span className="text-xs text-muted-foreground">{format(new Date(session.createdAt), "PPp")}</span>
            <span className={`inline-flex w-fit rounded-sm border px-2 py-0.5 text-xs ${complexityClass(session.complexityScore)}`}>
              {session.complexityScore ?? "-"}
            </span>
            <span className={`inline-flex w-fit rounded-sm border px-2 py-0.5 text-xs ${statusClass[session.status]}`}>
              {session.status}
            </span>
            <span className="text-xs text-muted-foreground">
              {session.diagramsCount} diagrams · {session.docsCount} docs
            </span>
            <div className="text-right">
              <button
                onClick={() => {
                  hydrateSessionFromHistory(session.threadId);
                  setSessionStatus(session.status === "Running" ? "running" : session.status === "Failed" ? "failed" : "complete");
                  navigate(`/swarm/session/${session.threadId}`);
                }}
                className="rounded-xl border border-border bg-background px-3 py-1.5 text-xs text-foreground"
              >
                View
              </button>
            </div>
          </div>
        ))}

        <div ref={sentinelRef} className="h-8" />
      </div>
    </section>
  );
};

export default SessionHistoryPage;

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { MermaidDiagram } from "@/features/swarm/components/MermaidDiagram";

export const AgentGraphFlow = () => {
  const [imageUnavailable, setImageUnavailable] = useState(false);
  const [mermaidGraph, setMermaidGraph] = useState<string>("");

  useEffect(() => {
    if (!imageUnavailable) {
      return;
    }
    let mounted = true;
    const loadFallbackMermaid = async () => {
      try {
        const response = await api.agent.getMermaidGraph(false);
        if (mounted) {
          setMermaidGraph(response.mermaid);
        }
      } catch {
        if (mounted) {
          setMermaidGraph("");
        }
      }
    };
    void loadFallbackMermaid();
    return () => {
      mounted = false;
    };
  }, [imageUnavailable]);

  const graphImageUrl = useMemo(() => api.agent.getImageGraphUrl(false), []);

  return (
    <section className="rounded-xl border border-border/70 bg-card p-3">
      <h3 className="mb-3 text-sm font-semibold text-foreground">Swarm Topology</h3>
      {!imageUnavailable ? (
        <div className="overflow-hidden rounded-xl border border-border">
          <img
            src={graphImageUrl}
            alt="LangGraph topology"
            className="h-56 w-full object-contain"
            onError={() => setImageUnavailable(true)}
          />
        </div>
      ) : mermaidGraph ? (
        <MermaidDiagram code={mermaidGraph} />
      ) : (
        <div className="flex h-56 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
          Topology graph unavailable.
        </div>
      )}
    </section>
  );
};

import { useEffect, useMemo, useRef, useState } from "react";
import mermaid from "mermaid";

let initialized = false;

interface MermaidDiagramProps {
  code: string;
}

export const MermaidDiagram = ({ code }: MermaidDiagramProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const renderId = useMemo(() => `swarm-mermaid-${crypto.randomUUID()}`, [code]);

  useEffect(() => {
    if (!initialized) {
      mermaid.initialize({
        startOnLoad: false,
        theme: "dark",
        securityLevel: "loose",
      });
      initialized = true;
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const render = async () => {
      if (!containerRef.current) {
        return;
      }

      try {
        const { svg } = await mermaid.render(renderId, code);
        if (!mounted || !containerRef.current) {
          return;
        }
        containerRef.current.innerHTML = svg;
        setError(null);
      } catch {
        setError(code);
      }
    };

    void render();

    return () => {
      mounted = false;
    };
  }, [code, renderId]);

  if (error) {
    return (
      <pre className="max-h-[60vh] overflow-auto rounded-xl border border-destructive/30 bg-card p-4 font-mono text-xs text-destructive">
        {error}
      </pre>
    );
  }

  return (
    <div className="rounded-xl border border-border/70 bg-card p-2 transition-opacity duration-200">
      <div ref={containerRef} className="min-h-[420px] overflow-auto [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full" />
    </div>
  );
};

import { useEffect, useId, useState } from "react";

export function MermaidDiagram({ source }: { source: string }) {
  const id = useId().replace(/:/g, "");
  const [result, setResult] = useState<{
    source: string;
    svg: string;
    error: string | null;
  }>({ source: "", svg: "", error: null });

  useEffect(() => {
    let cancelled = false;
    if (!source.trim()) return;
    void import("mermaid")
      .then(({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "neutral",
        });
        return mermaid.render(`mermaid-${id}`, source);
      })
      .then((rendered) => {
        if (!cancelled) setResult({ source, svg: rendered.svg, error: null });
      })
      .catch(() => {
        if (!cancelled)
          setResult({
            source,
            svg: "",
            error: "This Mermaid diagram could not be rendered.",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [id, source]);

  if (!source.trim())
    return (
      <p className="text-xs text-muted-foreground">
        No Mermaid source was generated.
      </p>
    );
  if (result.source === source && result.error)
    return (
      <div>
        <p role="alert" className="text-xs text-destructive">
          {result.error}
        </p>
        <pre className="mt-3 overflow-auto bg-muted/40 p-3 text-xs">
          {source}
        </pre>
      </div>
    );
  if (result.source !== source || !result.svg)
    return <p className="text-xs text-muted-foreground">Rendering diagram…</p>;
  return (
    <div
      className="overflow-auto [&_svg]:mx-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: result.svg }}
    />
  );
}

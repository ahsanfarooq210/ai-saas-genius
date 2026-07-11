import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";

import { Button } from "@/components/ui/button";
import { MermaidDiagram } from "./MermaidDiagram";

const cache = new Map<string, string>();
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

function resolveArtifactUrl(url: string): string {
  try {
    return new URL(url, API_BASE_URL).toString();
  } catch {
    return url;
  }
}

export function ArtifactContent({
  url,
  storageKey,
  type,
}: {
  url: string;
  storageKey: string;
  type: "diagram" | "doc";
}) {
  const cacheKey = storageKey || url;
  const [result, setResult] = useState<{
    key: string;
    content: string;
    error: string | null;
  }>(() => ({
    key: cacheKey,
    content: cache.get(cacheKey) ?? "",
    error: null,
  }));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (cache.has(cacheKey)) return;
    const controller = new AbortController();
    void fetch(resolveArtifactUrl(url), {
      credentials: "include",
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok)
          throw new Error(
            `Artifact request failed with status ${response.status}`,
          );
        return response.text();
      })
      .then((value) => {
        cache.set(cacheKey, value);
        setResult({ key: cacheKey, content: value, error: null });
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setResult({
            key: cacheKey,
            content: "",
            error:
              reason instanceof Error
                ? reason.message
                : "Could not load this artifact.",
          });
      });
    return () => controller.abort();
  }, [attempt, cacheKey, url]);

  const content =
    result.key === cacheKey ? result.content : (cache.get(cacheKey) ?? "");
  const error = result.key === cacheKey ? result.error : null;
  if (error)
    return (
      <div className="space-y-2">
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Retry artifact
        </Button>
      </div>
    );
  if (!content)
    return <p className="text-xs text-muted-foreground">Loading artifact…</p>;
  if (type === "diagram") return <MermaidDiagram source={content} />;
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert">
      <ReactMarkdown rehypePlugins={[rehypeSanitize]} skipHtml>
        {content}
      </ReactMarkdown>
    </div>
  );
}

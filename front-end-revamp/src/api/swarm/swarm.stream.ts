import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, getCookie } from "../cookies";
import type {
  SwarmResumeRequest,
  SwarmRunRequest,
  SwarmStreamHandlers,
} from "./swarm.types";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const SWARM_BASE_PATH = "/api/v1/swarm";

function dispatchFrame(frame: string, handlers: SwarmStreamHandlers): void {
  let eventName = "message";
  const dataLines: string[] = [];

  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }

  if (dataLines.length === 0) {
    return;
  }

  try {
    const data = JSON.parse(dataLines.join("\n"));
    switch (eventName) {
      case "progress":
        handlers.onProgress?.(data);
        break;
      case "done":
        handlers.onDone?.(data);
        break;
      case "error":
        handlers.onError?.(data);
        break;
    }
  } catch {
    // Ignore malformed/partial SSE frames rather than crashing the stream.
  }
}

async function consumeSSE(
  path: string,
  body: unknown,
  handlers: SwarmStreamHandlers,
  signal: AbortSignal,
): Promise<void> {
  const csrfToken = getCookie(CSRF_COOKIE_NAME);

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...(csrfToken ? { [CSRF_HEADER_NAME]: csrfToken } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(
      `Swarm stream request to ${path} failed with status ${response.status}`,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      dispatchFrame(frame, handlers);
    }
  }

  if (buffer.trim()) {
    dispatchFrame(buffer, handlers);
  }
}

function runStream(
  path: string,
  body: SwarmRunRequest | SwarmResumeRequest,
  handlers: SwarmStreamHandlers,
): AbortController {
  const controller = new AbortController();

  consumeSSE(path, body, handlers, controller.signal).catch((error) => {
    if (controller.signal.aborted) {
      return;
    }
    handlers.onError?.({
      thread_id: body.thread_id,
      status: "failed",
      message: error instanceof Error ? error.message : "Unknown stream error",
    });
  });

  return controller;
}

export function streamSwarmRun(
  input: SwarmRunRequest,
  handlers: SwarmStreamHandlers,
): AbortController {
  return runStream(`${SWARM_BASE_PATH}/run/stream`, input, handlers);
}

export function streamSwarmResume(
  input: SwarmResumeRequest,
  handlers: SwarmStreamHandlers,
): AbortController {
  return runStream(`${SWARM_BASE_PATH}/resume/stream`, input, handlers);
}

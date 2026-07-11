import { refreshAuthSession } from "../client";
import { getAccessToken } from "@/api/auth/access-token";
import { shouldRedirectToLogin } from "@/features/auth/auth-navigation";
import type {
  SwarmResumeRequest,
  SwarmReviseRequest,
  SwarmRunRequest,
  SwarmStreamHandlers,
} from "./swarm.types";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const SWARM_BASE_PATH = "/api/v1/swarm";

export class SwarmStreamHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "SwarmStreamHttpError";
    this.status = status;
  }
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail)) {
      const messages = body.detail.flatMap((item) =>
        typeof item === "object" &&
        item !== null &&
        "msg" in item &&
        typeof item.msg === "string"
          ? [item.msg]
          : [],
      );
      if (messages.length) return messages.join(" ");
    }
  } catch {
    // The status remains useful when the body is not JSON.
  }
  return `Request failed with status ${response.status}`;
}

export function dispatchSSEFrame(
  frame: string,
  handlers: SwarmStreamHandlers,
): "done" | "error" | null {
  let eventName = "message";
  const dataLines: string[] = [];

  for (const rawLine of frame.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    else if (line.startsWith("data:"))
      dataLines.push(line.slice(5).trimStart());
  }
  if (!dataLines.length) return null;

  let data: unknown;
  try {
    data = JSON.parse(dataLines.join("\n"));
  } catch {
    return null;
  }

  if (eventName === "progress")
    handlers.onProgress?.(
      data as Parameters<NonNullable<typeof handlers.onProgress>>[0],
    );
  else if (eventName === "done") {
    handlers.onDone?.(
      data as Parameters<NonNullable<typeof handlers.onDone>>[0],
    );
    return "done";
  } else if (eventName === "error") {
    handlers.onError?.(
      data as Parameters<NonNullable<typeof handlers.onError>>[0],
    );
    return "error";
  }
  return null;
}

type StreamBody = SwarmRunRequest | SwarmReviseRequest | SwarmResumeRequest;

async function openStream(
  path: string,
  body: StreamBody,
  signal: AbortSignal,
  didRefresh = false,
): Promise<Response> {
  const accessToken = getAccessToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });
  if (response.status === 401 && !didRefresh) {
    try {
      await refreshAuthSession();
    } catch {
      if (
        typeof window !== "undefined" &&
        shouldRedirectToLogin(window.location.pathname)
      ) {
        window.location.assign("/login");
      }
      throw new SwarmStreamHttpError(
        401,
        "Your session expired. Please sign in again.",
      );
    }
    return openStream(path, body, signal, true);
  }
  if (!response.ok)
    throw new SwarmStreamHttpError(
      response.status,
      await responseError(response),
    );
  if (!response.body)
    throw new Error("The server returned an empty event stream.");
  return response;
}

export async function consumeSwarmSSE(
  path: string,
  body: StreamBody,
  handlers: SwarmStreamHandlers,
  signal: AbortSignal,
): Promise<void> {
  const response = await openStream(path, body, signal);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminalEvent: "done" | "error" | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames)
      terminalEvent = dispatchSSEFrame(frame, handlers) ?? terminalEvent;
  }

  buffer += decoder.decode().replace(/\r\n/g, "\n");
  if (buffer.trim())
    terminalEvent = dispatchSSEFrame(buffer, handlers) ?? terminalEvent;
  if (!terminalEvent && !signal.aborted)
    throw new Error(
      "The operation stream ended before completion. The backend may still be running.",
    );
}

function stream(
  path: string,
  body: StreamBody,
  handlers: SwarmStreamHandlers,
): AbortController {
  const controller = new AbortController();
  void consumeSwarmSSE(path, body, handlers, controller.signal).catch(
    (error: unknown) => {
      if (controller.signal.aborted) return;
      handlers.onError?.({
        thread_id: body.thread_id,
        status: "failed",
        message:
          error instanceof Error ? error.message : "Unknown stream error",
      });
    },
  );
  return controller;
}

export function streamSwarmRun(
  input: SwarmRunRequest,
  handlers: SwarmStreamHandlers,
): AbortController {
  return stream(`${SWARM_BASE_PATH}/run/stream`, input, handlers);
}
export function streamSwarmRevise(
  input: SwarmReviseRequest,
  handlers: SwarmStreamHandlers,
): AbortController {
  return stream(`${SWARM_BASE_PATH}/revise/stream`, input, handlers);
}
export function streamSwarmResume(
  input: SwarmResumeRequest,
  handlers: SwarmStreamHandlers,
): AbortController {
  return stream(`${SWARM_BASE_PATH}/resume/stream`, input, handlers);
}

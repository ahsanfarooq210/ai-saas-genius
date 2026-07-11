import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAccessToken, setAccessToken } from "@/api/auth/access-token";

const { refreshAuthSession } = vi.hoisted(() => ({
  refreshAuthSession: vi.fn(),
}));
vi.mock("../client", () => ({ refreshAuthSession }));

import {
  consumeSwarmSSE,
  dispatchSSEFrame,
  streamSwarmRun,
} from "./swarm.stream";
import type { SwarmProgressEvent } from "./swarm.types";

const request = {
  task_requirement: "Design a URL shortener",
  thread_id: "thread-1",
};

function responseFromChunks(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearAccessToken();
});

describe("swarm SSE transport", () => {
  it("reassembles a frame split across chunks", async () => {
    const progress: SwarmProgressEvent[] = [];
    const done = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          responseFromChunks([
            'event: progress\ndata: {"thread_id":"thread-1","type":"task_',
            'started","node":"architect_graph","phase":"architecture","message":"Drafting","iteration_count":1,"payload":{}}\n\nevent: done\ndata: {"thread_id":"thread-1","status":"done"}\n\n',
          ]),
        ),
    );
    await consumeSwarmSSE(
      "/run/stream",
      request,
      { onProgress: (event) => progress.push(event), onDone: done },
      new AbortController().signal,
    );
    expect(progress).toHaveLength(1);
    expect(progress[0].message).toBe("Drafting");
    expect(done).toHaveBeenCalledOnce();
  });

  it("handles multiple CRLF frames in one chunk", async () => {
    const progress = vi.fn();
    const done = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          responseFromChunks([
            'event: progress\r\ndata: {"thread_id":"thread-1","type":"state_update","node":"supervisor_node","phase":"supervisor","message":"Planning","iteration_count":1,"payload":{}}\r\n\r\nevent: done\r\ndata: {"thread_id":"thread-1","status":"done"}\r\n\r\n',
          ]),
        ),
    );
    await consumeSwarmSSE(
      "/run/stream",
      request,
      { onProgress: progress, onDone: done },
      new AbortController().signal,
    );
    expect(progress).toHaveBeenCalledOnce();
    expect(done).toHaveBeenCalledOnce();
  });

  it("ignores invalid JSON and unknown events safely", () => {
    const handlers = { onProgress: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
    expect(
      dispatchSSEFrame("event: progress\ndata: {bad json}", handlers),
    ).toBeNull();
    expect(
      dispatchSSEFrame('event: future_event\ndata: {"ok":true}', handlers),
    ).toBeNull();
    expect(handlers.onProgress).not.toHaveBeenCalled();
  });

  it("rejects an unexpected end without done or error", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          responseFromChunks([
            'event: progress\ndata: {"thread_id":"thread-1"}\n\n',
          ]),
        ),
    );
    await expect(
      consumeSwarmSSE("/run/stream", request, {}, new AbortController().signal),
    ).rejects.toThrow("ended before completion");
  });

  it("does not report user cancellation as generation failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          }),
      ),
    );
    const onError = vi.fn();
    const controller = streamSwarmRun(request, { onError });
    controller.abort();
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).not.toHaveBeenCalled();
  });

  it("refreshes once after 401 and retries with credentials", async () => {
    refreshAuthSession.mockResolvedValueOnce(undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "Expired" }), { status: 401 }),
      )
      .mockResolvedValueOnce(
        responseFromChunks([
          'event: done\ndata: {"thread_id":"thread-1","status":"done"}\n\n',
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);
    await consumeSwarmSSE(
      "/run/stream",
      request,
      {},
      new AbortController().signal,
    );
    expect(refreshAuthSession).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      credentials: "include",
    });
  });

  it("surfaces FastAPI 409 details before streaming starts", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ detail: "Thread is already running: thread-1" }),
            { status: 409 },
          ),
        ),
    );
    await expect(
      consumeSwarmSSE(
        "/revise/stream",
        { thread_id: "thread-1", instruction: "Use Redis" },
        {},
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      status: 409,
      message: "Thread is already running: thread-1",
    });
  });

  it("adds the in-memory bearer token to streaming requests", async () => {
    setAccessToken("access-token-123");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        responseFromChunks([
          'event: done\ndata: {"thread_id":"thread-1","status":"done"}\n\n',
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);

    await consumeSwarmSSE(
      "/run/stream",
      request,
      {},
      new AbortController().signal,
    );

    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      Authorization: "Bearer access-token-123",
    });
  });
});

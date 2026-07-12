import { beforeEach, describe, expect, it, vi } from "vitest";

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../client", () => ({ apiClient: { post, get } }));

import {
  listSwarmSessions,
  resumeSwarmRun,
  reviseSwarmRun,
  startSwarmRun,
} from "./swarm.api";

describe("blocking swarm request contracts", () => {
  beforeEach(() => post.mockReset().mockResolvedValue({ data: {} }));
  it("uses the initial run shape", async () => {
    await startSwarmRun({ task_requirement: "Design it", thread_id: "t1" });
    expect(post).toHaveBeenCalledWith(
      "/api/v1/swarm/run",
      { task_requirement: "Design it", thread_id: "t1" },
      undefined,
    );
  });
  it("uses the revision instruction shape", async () => {
    await reviseSwarmRun({ thread_id: "t1", instruction: "Use Redis" });
    expect(post).toHaveBeenCalledWith(
      "/api/v1/swarm/revise",
      { thread_id: "t1", instruction: "Use Redis" },
      undefined,
    );
  });
  it("keeps resume instruction-free", async () => {
    await resumeSwarmRun({ thread_id: "t1" });
    expect(post).toHaveBeenCalledWith(
      "/api/v1/swarm/resume",
      { thread_id: "t1" },
      undefined,
    );
  });
});

describe("session list contract", () => {
  beforeEach(() => get.mockReset());

  it("fetches all sessions from the collection endpoint", async () => {
    get.mockResolvedValue({ data: { sessions: [] } });

    await expect(listSwarmSessions()).resolves.toEqual({ sessions: [] });
    expect(get).toHaveBeenCalledWith("/api/v1/swarm/sessions", undefined);
  });

  it("normalizes a bare FastAPI list response", async () => {
    const sessions = [{ thread_id: "thread-1" }];
    get.mockResolvedValue({ data: sessions });

    await expect(listSwarmSessions()).resolves.toEqual({ sessions });
  });
});

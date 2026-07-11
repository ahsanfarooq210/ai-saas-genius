import { beforeEach, describe, expect, it, vi } from "vitest";

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("../client", () => ({ apiClient: { post, get: vi.fn() } }));

import { resumeSwarmRun, reviseSwarmRun, startSwarmRun } from "./swarm.api";

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

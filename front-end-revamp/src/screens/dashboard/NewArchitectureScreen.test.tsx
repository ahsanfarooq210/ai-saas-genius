// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SwarmStreamHandlers } from "@/api/swarm";

const api = vi.hoisted(() => ({
  getSwarmSession: vi.fn(),
  listSwarmRevisions: vi.fn(),
  streamSwarmRun: vi.fn(),
}));
vi.mock("@/api/swarm", () => api);
vi.mock("@/features/projects/project-storage", () => ({
  createThreadId: () => "thread-1",
  saveRecentProject: vi.fn(),
}));
vi.mock("@/screens/dashboard/DashboardShell", () => ({
  DashboardShell: ({ children }: { children: React.ReactNode }) => children,
}));

import { NewArchitectureScreen } from "./NewArchitectureScreen";

describe("NewArchitectureScreen", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows streamed progress events while generation is running", async () => {
    let handlers: SwarmStreamHandlers | undefined;
    api.streamSwarmRun.mockImplementation(
      (_input: unknown, nextHandlers: SwarmStreamHandlers) => {
        handlers = nextHandlers;
        return new AbortController();
      },
    );

    render(
      <MemoryRouter>
        <NewArchitectureScreen />
      </MemoryRouter>,
    );

    fireEvent.change(
      screen.getByPlaceholderText(/Describe the product, users, scale/i),
      { target: { value: "Design a billing platform" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Generate architecture" }),
    );

    expect(screen.getByText("Live activity")).toBeVisible();
    expect(screen.getByText(/Waiting for the first update/i)).toBeVisible();

    await act(async () => {
      handlers?.onProgress?.({
        thread_id: "thread-1",
        type: "state_update",
        node: "lead_architect",
        phase: "architecture",
        message: "Drafting the component architecture",
        iteration_count: 1,
        payload: {},
      });
    });

    expect(screen.getAllByText("Architecture").length).toBeGreaterThan(0);
    expect(screen.getByText("lead_architect")).toBeVisible();
    expect(
      screen.getAllByText("Drafting the component architecture").length,
    ).toBeGreaterThan(0);
  });
});

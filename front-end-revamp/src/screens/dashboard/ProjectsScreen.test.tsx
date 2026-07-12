// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ listSwarmSessions: vi.fn() }));
vi.mock("@/api/swarm", () => api);
vi.mock("@/screens/dashboard/DashboardShell", () => ({
  DashboardShell: ({ children }: { children: React.ReactNode }) => children,
}));

import { ProjectsScreen } from "./ProjectsScreen";

describe("ProjectsScreen", () => {
  afterEach(cleanup);

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("loads and renders projects from the backend", async () => {
    api.listSwarmSessions.mockResolvedValue({
      sessions: [
        {
          thread_id: "thread-1",
          requirement: "Design a billing platform",
          revision_number: 2,
          status: "done",
          complexity: 4,
          diagram_count: 2,
          doc_count: 3,
          created_at: "2026-07-12T10:00:00Z",
          completed_at: "2026-07-12T10:05:00Z",
        },
      ],
    });

    render(
      <MemoryRouter>
        <ProjectsScreen />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Design a billing platform")).toBeVisible();
    expect(screen.getByText("Revision 2")).toBeVisible();
    expect(api.listSwarmSessions).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: /thread-1/i })).toHaveAttribute(
      "href",
      "/dashboard/projects/thread-1/overview",
    );
  });

  it("shows an empty state when the account has no projects", async () => {
    api.listSwarmSessions.mockResolvedValue({ sessions: [] });

    render(
      <MemoryRouter>
        <ProjectsScreen />
      </MemoryRouter>,
    );

    expect(await screen.findByText("No projects yet")).toBeVisible();
  });
});

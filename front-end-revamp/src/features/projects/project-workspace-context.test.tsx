// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  SwarmRevisionListResponse,
  SwarmSessionResponse,
  SwarmStreamHandlers,
} from "@/api/swarm";

const api = vi.hoisted(() => ({
  getSwarmRevision: vi.fn(),
  getSwarmSession: vi.fn(),
  listSwarmRevisions: vi.fn(),
  streamSwarmRevise: vi.fn(),
}));
vi.mock("@/api/swarm", () => api);
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import {
  ProjectWorkspaceProvider,
  useProjectWorkspace,
} from "./project-workspace-context";

const session = (revision: number, status = "done"): SwarmSessionResponse => ({
  thread_id: "thread-1",
  requirement: "Design a URL shortener",
  revision_number: revision,
  latest_instruction: revision === 1 ? "Design a URL shortener" : "Use Redis",
  status,
  complexity: 4,
  diagram_count: 0,
  doc_count: 0,
  architecture_draft: `draft-${revision}`,
  architecture_json: {},
  component_list: [],
  current_architecture_mermaid: "",
  diagram_plan: [],
  doc_plan: [],
  deep_dive_notes: "",
  docs_complete: true,
  iteration_count: revision,
  next_agent: "",
  scalability_feedback: "APPROVED",
  security_feedback: "APPROVED",
  debate_logs: [],
  created_at: null,
  completed_at: null,
  generated_diagrams: [],
  generated_docs: [],
});

const history = (
  currentRevision: number,
  failed = false,
): SwarmRevisionListResponse => ({
  thread_id: "thread-1",
  current_revision: currentRevision,
  revisions: [
    {
      revision_number: 1,
      instruction: "Design a URL shortener",
      status: "done",
      created_at: null,
      completed_at: null,
    },
    ...(currentRevision === 2
      ? [
          {
            revision_number: 2,
            instruction: "Use Redis",
            status: "done" as const,
            created_at: null,
            completed_at: null,
          },
        ]
      : failed
        ? [
            {
              revision_number: 2,
              instruction: "Use Redis",
              status: "failed" as const,
              created_at: null,
              completed_at: null,
            },
          ]
        : []),
  ],
});

function Harness() {
  const workspace = useProjectWorkspace();
  return (
    <div>
      <output data-testid="revision">
        {workspace.visibleWorkspace?.revisionNumber ?? "loading"}
      </output>
      <output data-testid="draft">
        {workspace.visibleWorkspace?.architectureDraft ?? ""}
      </output>
      <output data-testid="error">{workspace.streamError ?? ""}</output>
      <button onClick={() => workspace.submitRevision("Use Redis")}>
        revise
      </button>
    </div>
  );
}

describe("ProjectWorkspaceProvider", () => {
  afterEach(cleanup);

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("refetches session and history after done, then promotes the new revision", async () => {
    let handlers: SwarmStreamHandlers | undefined;
    api.getSwarmSession
      .mockResolvedValueOnce(session(1))
      .mockResolvedValueOnce(session(2));
    api.listSwarmRevisions
      .mockResolvedValueOnce(history(1))
      .mockResolvedValueOnce(history(2));
    api.streamSwarmRevise.mockImplementation(
      (_request: unknown, nextHandlers: SwarmStreamHandlers) => {
        handlers = nextHandlers;
        return new AbortController();
      },
    );

    render(
      <ProjectWorkspaceProvider threadId="thread-1">
        <Harness />
      </ProjectWorkspaceProvider>,
    );
    await screen.findByText("draft-1");
    fireEvent.click(screen.getByText("revise"));
    await act(async () => {
      handlers?.onDone?.({ thread_id: "thread-1", status: "done" });
    });
    await waitFor(() =>
      expect(screen.getByTestId("revision")).toHaveTextContent("2"),
    );
    expect(screen.getByTestId("draft")).toHaveTextContent("draft-2");
    expect(api.listSwarmRevisions).toHaveBeenCalledTimes(2);
  });

  it("keeps the previous successful workspace after an SSE error", async () => {
    let handlers: SwarmStreamHandlers | undefined;
    api.getSwarmSession
      .mockResolvedValueOnce(session(1))
      .mockResolvedValueOnce(session(1, "failed"));
    api.listSwarmRevisions
      .mockResolvedValueOnce(history(1))
      .mockResolvedValueOnce(history(1, true));
    api.streamSwarmRevise.mockImplementation(
      (_request: unknown, nextHandlers: SwarmStreamHandlers) => {
        handlers = nextHandlers;
        return new AbortController();
      },
    );

    render(
      <ProjectWorkspaceProvider threadId="thread-1">
        <Harness />
      </ProjectWorkspaceProvider>,
    );
    await screen.findByText("draft-1");
    fireEvent.click(screen.getByText("revise"));
    await act(async () => {
      handlers?.onError?.({
        thread_id: "thread-1",
        status: "failed",
        message: "Security review rejected the revision",
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("error")).toHaveTextContent(
        "Security review rejected",
      ),
    );
    expect(screen.getByTestId("revision")).toHaveTextContent("1");
    expect(screen.getByTestId("draft")).toHaveTextContent("draft-1");
  });
});

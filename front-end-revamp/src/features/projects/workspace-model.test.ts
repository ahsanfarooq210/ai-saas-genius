import { describe, expect, it } from "vitest";
import {
  normalizeCurrentSession,
  normalizeHistoricalRevision,
} from "./workspace-model";
import type { SwarmRevisionDetail, SwarmSessionResponse } from "@/api/swarm";

const session: SwarmSessionResponse = {
  thread_id: "thread-1",
  requirement: "Original",
  revision_number: 2,
  latest_instruction: "Use Redis",
  status: "failed",
  complexity: 5,
  diagram_count: 1,
  doc_count: 1,
  architecture_draft: "draft",
  architecture_json: { API: { description: "edge", relations: ["DB"] } },
  component_list: ["API"],
  current_architecture_mermaid: "flowchart LR",
  diagram_plan: [],
  doc_plan: [],
  deep_dive_notes: "",
  docs_complete: true,
  iteration_count: 2,
  next_agent: "",
  scalability_feedback: "APPROVED",
  security_feedback: "APPROVED",
  debate_logs: [],
  created_at: null,
  completed_at: null,
  generated_diagrams: [
    {
      artifact_type: "diagram",
      name: "Overview",
      component_slug: "",
      storage_key: "d1",
      url: "/d1",
      iteration: 2,
    },
    {
      artifact_type: "doc",
      name: "wrong collection",
      component_slug: "",
      storage_key: "x",
      url: "/x",
      iteration: null,
    },
  ],
  generated_docs: [
    {
      artifact_type: "doc",
      name: "System",
      component_slug: "",
      storage_key: "m1",
      url: "/m1",
      iteration: null,
    },
  ],
};

describe("workspace normalization", () => {
  it("keeps the last successful current projection even when session status is failed", () => {
    const model = normalizeCurrentSession(session);
    expect(model.revisionNumber).toBe(2);
    expect(model.status).toBe("failed");
    expect(model.diagrams.map((item) => item.name)).toEqual(["Overview"]);
    expect(model.documents.map((item) => item.name)).toEqual(["System"]);
  });

  it("adapts raw historical artifact and instruction names", () => {
    const detail: SwarmRevisionDetail = {
      thread_id: "thread-1",
      revision_number: 1,
      instruction: "Original",
      status: "done",
      created_at: null,
      completed_at: null,
      result: {
        task_requirement: "Original",
        revision_instruction: "Original",
        architecture_json: {},
        generated_diagrams: [
          {
            diagram_type: "overview",
            component_slug: "",
            storage_key: "d",
            url: "/d",
            iteration: 1,
          },
        ],
        generated_docs: [
          {
            title: "Overview doc",
            component_slug: "",
            storage_key: "m",
            url: "/m",
          },
        ],
      },
    };
    const model = normalizeHistoricalRevision(detail);
    expect(model?.latestInstruction).toBe("Original");
    expect(model?.diagrams[0].name).toBe("overview");
    expect(model?.documents[0].name).toBe("Overview doc");
  });

  it("never renders an empty failed revision as a workspace", () => {
    const failed: SwarmRevisionDetail = {
      thread_id: "thread-1",
      revision_number: 3,
      instruction: "Break it",
      status: "failed",
      created_at: null,
      completed_at: null,
      result: {},
    };
    expect(normalizeHistoricalRevision(failed)).toBeNull();
  });
});

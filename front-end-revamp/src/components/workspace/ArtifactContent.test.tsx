// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ArtifactContent } from "./ArtifactContent";

describe("ArtifactContent", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("omits credentials when fetching a public Cloudinary artifact", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("# System overview", {
        status: 200,
        headers: { "Content-Type": "text/markdown" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ArtifactContent
        url="https://res.cloudinary.com/example/raw/upload/system-overview.md"
        storageKey="cors-test-cloudinary-doc"
        type="doc"
      />,
    );

    await screen.findByText("System overview");
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "https://res.cloudinary.com/example/raw/upload/system-overview.md",
        expect.objectContaining({ credentials: "omit" }),
      ),
    );
  });

  it("keeps credentials for backend-relative artifact URLs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("# Backend document", {
        status: 200,
        headers: { "Content-Type": "text/markdown" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ArtifactContent
        url="/api/v1/swarm/artifacts/document.md"
        storageKey="cors-test-backend-doc"
        type="doc"
      />,
    );

    await screen.findByText("Backend document");
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:8000/api/v1/swarm/artifacts/document.md",
        expect.objectContaining({ credentials: "include" }),
      ),
    );
  });
});

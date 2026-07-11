import { afterEach, describe, expect, it, vi } from "vitest";

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("../client", () => ({ apiClient: { post, get: vi.fn() } }));

import { clearAccessToken, getAccessToken } from "./access-token";
import { logIn, logout } from "./auth.api";

describe("auth API token handoff", () => {
  afterEach(() => {
    clearAccessToken();
    vi.clearAllMocks();
  });

  it("retains the login access token for subsequent API requests", async () => {
    post.mockResolvedValueOnce({
      data: {
        access_token: "access-token-123",
        refresh_token: "refresh-token-123",
        token_type: "bearer",
      },
    });

    await logIn({ email: "user@example.com", password: "password" });

    expect(getAccessToken()).toBe("access-token-123");
  });

  it("clears the in-memory token on logout", async () => {
    post.mockResolvedValueOnce({
      data: {
        access_token: "access-token-123",
        refresh_token: "refresh-token-123",
        token_type: "bearer",
      },
    });
    await logIn({ email: "user@example.com", password: "password" });
    post.mockResolvedValueOnce({ data: { detail: "Logged out" } });

    await logout();

    expect(getAccessToken()).toBeNull();
  });
});

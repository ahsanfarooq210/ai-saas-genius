import { afterEach, describe, expect, it } from "vitest";

import {
  clearAccessToken,
  getAccessToken,
  setAccessToken,
} from "./access-token";

describe("in-memory access token", () => {
  afterEach(clearAccessToken);

  it("retains a token for authenticated API requests", () => {
    setAccessToken("access-token-123");
    expect(getAccessToken()).toBe("access-token-123");
  });

  it("clears the token on logout or failed refresh", () => {
    setAccessToken("access-token-123");
    clearAccessToken();
    expect(getAccessToken()).toBeNull();
  });
});

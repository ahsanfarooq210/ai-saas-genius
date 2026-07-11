import { describe, expect, it } from "vitest";

import { shouldRedirectToLogin } from "./auth-navigation";

describe("shouldRedirectToLogin", () => {
  it("does not redirect while already on a public authentication screen", () => {
    expect(shouldRedirectToLogin("/login")).toBe(false);
    expect(shouldRedirectToLogin("/signup")).toBe(false);
  });

  it("redirects expired protected routes to login", () => {
    expect(shouldRedirectToLogin("/dashboard/projects")).toBe(true);
  });
});

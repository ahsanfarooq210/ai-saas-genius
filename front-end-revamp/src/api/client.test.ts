import { afterEach, describe, expect, it, vi } from "vitest";

const mockedAxios = vi.hoisted(() => ({
  apiCall: vi.fn(),
  requestUse: vi.fn(),
  responseUse: vi.fn(),
  refreshPost: vi.fn(),
}));

vi.mock("axios", () => {
  const apiInstance = Object.assign(mockedAxios.apiCall, {
    interceptors: {
      request: { use: mockedAxios.requestUse },
      response: { use: mockedAxios.responseUse },
    },
  });
  const refreshInstance = { post: mockedAxios.refreshPost };
  return {
    default: {
      create: vi
        .fn()
        .mockReturnValueOnce(apiInstance)
        .mockReturnValueOnce(refreshInstance),
    },
  };
});

import {
  clearAccessToken,
  getAccessToken,
  setAccessToken,
} from "./auth/access-token";
import "./client";

type RequestConfig = {
  headers: { set: (name: string, value: string) => void };
};

const requestInterceptor = mockedAxios.requestUse.mock.calls[0][0] as (
  config: RequestConfig,
) => RequestConfig;
const responseInterceptor = mockedAxios.responseUse.mock.calls[0][1] as (
  error: unknown,
) => Promise<unknown>;

describe("authenticated Axios client", () => {
  afterEach(() => {
    clearAccessToken();
    vi.clearAllMocks();
  });

  it("adds the current bearer token to API requests", () => {
    setAccessToken("access-token-123");
    const setHeader = vi.fn();
    requestInterceptor({ headers: { set: setHeader } });

    expect(setHeader).toHaveBeenCalledWith(
      "Authorization",
      "Bearer access-token-123",
    );
  });

  it("replaces the in-memory token when refresh succeeds", async () => {
    setAccessToken("expired-token");
    mockedAxios.refreshPost.mockResolvedValueOnce({
      data: { access_token: "fresh-token" },
    });
    mockedAxios.apiCall.mockResolvedValueOnce({ data: {} });
    await responseInterceptor({
      config: { url: "/api/v1/swarm/state/thread-1", headers: {} },
      response: { status: 401 },
    });

    expect(getAccessToken()).toBe("fresh-token");
    expect(mockedAxios.apiCall).toHaveBeenCalledOnce();
  });
});

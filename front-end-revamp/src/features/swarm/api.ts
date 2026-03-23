import type { SessionHistoryItem } from "@/features/swarm/types";

export interface CreateThreadResponse {
  thread_id: string;
  thread_name?: string;
}

export interface AgentGraphMermaidResponse {
  mermaid: string;
}

interface HumanFeedbackPayload {
  thread_id: string;
  critique: string;
}

interface RequestOptions extends RequestInit {
  json?: unknown;
  retryOnAuthFailure?: boolean;
}

const SWARM_API_PREFIX = "/api/v1/agent";
const AUTH_API_PREFIX = "/api/v1/auth";
const MAX_REQUIREMENT_LENGTH = 50_000;

const getBackendBase = () => {
  const fallback = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? "http://localhost:8000";
  const raw = localStorage.getItem("swarm_settings");
  if (!raw) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(raw) as { backendUrl?: string };
    return parsed.backendUrl ?? fallback;
  } catch {
    return fallback;
  }
};

const getCookieValue = (name: string) => {
  if (typeof document === "undefined") {
    return null;
  }

  const match = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${encodeURIComponent(name)}=`));

  if (!match) {
    return null;
  }

  const [, value = ""] = match.split("=");
  return decodeURIComponent(value);
};

const getAccessToken = () => {
  const localToken = localStorage.getItem("accessToken") ?? sessionStorage.getItem("accessToken");
  if (localToken) {
    return localToken;
  }

  return getCookieValue("accessToken");
};

const buildUrl = (path: string, query?: Record<string, string | boolean | undefined | null>) => {
  const url = new URL(`${SWARM_API_PREFIX}${path}`, getBackendBase());

  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") {
        return;
      }
      url.searchParams.set(key, String(value));
    });
  }

  return url.toString();
};

const refreshSession = async () => {
  const refreshUrl = new URL(AUTH_API_PREFIX.concat("/refresh"), getBackendBase());
  const response = await fetch(refreshUrl.toString(), {
    method: "POST",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`Auth refresh failed: ${response.status}`);
  }
};

const request = async <T>(
  path: string,
  options: RequestOptions = {},
  query?: Record<string, string | boolean | undefined | null>,
): Promise<T> => {
  const { json, headers, retryOnAuthFailure = true, ...init } = options;
  const accessToken = getAccessToken();

  const response = await fetch(buildUrl(path, query), {
    credentials: "include",
    ...init,
    headers: {
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : init.body,
  });

  if ((response.status === 401 || response.status === 403) && retryOnAuthFailure) {
    await refreshSession();
    return request<T>(path, { ...options, retryOnAuthFailure: false }, query);
  }

  if (!response.ok) {
    throw new Error(`Swarm API request failed: ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
};

const validateRequirement = (requirement: string) => {
  const trimmed = requirement.trim();
  if (!trimmed) {
    throw new Error("Task requirement is required.");
  }
  if (trimmed.length > MAX_REQUIREMENT_LENGTH) {
    throw new Error(`Task requirement must be ${MAX_REQUIREMENT_LENGTH.toLocaleString()} characters or fewer.`);
  }
  return trimmed;
};

export const swarmApi = {
  async createThread(requirement: string, userId?: string | null): Promise<CreateThreadResponse> {
    const taskRequirement = validateRequirement(requirement);
    const response = await request<CreateThreadResponse>("/thread", {
      method: "POST",
      json: {
        task_requirement: taskRequirement,
        user_id: userId?.toString() ?? undefined,
      },
    });

    if (!response.thread_id) {
      throw new Error("Thread creation response did not include thread_id");
    }

    return response;
  },

  async start(requirement: string, userId?: string | null): Promise<CreateThreadResponse> {
    return this.createThread(requirement, userId);
  },

  buildStreamUrl(threadId: string, options?: { taskRequirement?: string; userId?: string | null }) {
    return buildUrl(`/stream/${threadId}`, {
      task_requirement: options?.taskRequirement,
      user_id: options?.userId?.toString() ?? undefined,
    });
  },

  getStreamRequestInit(): RequestInit {
    return {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "text/event-stream",
      },
    };
  },

  async getGraphMermaid(xray = false): Promise<AgentGraphMermaidResponse> {
    return request<AgentGraphMermaidResponse>("/graph/mermaid", { method: "GET" }, { xray });
  },

  async getGraphImage(xray = false): Promise<Blob> {
    const accessToken = getAccessToken();
    const response = await fetch(buildUrl("/graph/image", { xray }), {
      method: "GET",
      credentials: "include",
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch swarm graph image: ${response.status}`);
    }

    return response.blob();
  },

  async humanFeedback(payload: HumanFeedbackPayload): Promise<void> {
    void payload;
    throw new Error("Human feedback endpoint is not available in the current swarm backend.");
  },

  async listSessions(page = 1): Promise<{ items: SessionHistoryItem[]; hasMore: boolean }> {
    void page;
    return {
      items: [],
      hasMore: false,
    };
  },
};

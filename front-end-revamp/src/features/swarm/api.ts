import type { SessionHistoryItem } from "@/features/swarm/types";

interface StartSwarmResponse {
  thread_id: string;
}

interface HumanFeedbackPayload {
  thread_id: string;
  critique: string;
}

export const swarmApi = {
  async start(requirement: string): Promise<StartSwarmResponse> {
    const response = await fetch(`${getBackendBase()}/api/swarm/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ requirement }),
    });
    if (!response.ok) {
      throw new Error("Failed to start swarm");
    }
    return (await response.json()) as StartSwarmResponse;
  },

  async humanFeedback(payload: HumanFeedbackPayload): Promise<void> {
    const response = await fetch(`${getBackendBase()}/api/swarm/human-feedback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error("Failed to submit human feedback");
    }
  },

  async listSessions(page = 1): Promise<{ items: SessionHistoryItem[]; hasMore: boolean }> {
    try {
      const response = await fetch(
        `${getBackendBase()}/api/swarm/sessions?page=${page}`,
      );
      if (!response.ok) {
        throw new Error("Failed to list sessions");
      }
      const data = (await response.json()) as {
        items: SessionHistoryItem[];
        has_more: boolean;
      };
      return {
        items: data.items,
        hasMore: data.has_more,
      };
    } catch {
      return {
        items: [],
        hasMore: false,
      };
    }
  },
};

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

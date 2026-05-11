import { api } from "@/lib/api";
import type { SessionHistoryItem, SwarmRunRequest, SwarmRunResponse } from "@/features/swarm/types";

export const swarmApi = {
  /**
   * POST /api/v1/agent/run
   * Triggers the swarm and returns the full final SwarmRunResponse.
   * This is a long-running request and can take several minutes.
   */
  async run(payload: SwarmRunRequest): Promise<SwarmRunResponse> {
    return api.agent.run(payload);
  },

  /**
   * Session history is stored locally (no backend list endpoint in the current spec).
   * Returns an empty list with hasMore: false when nothing is stored locally.
   */
  async listSessions(_page = 1): Promise<{ items: SessionHistoryItem[]; hasMore: boolean }> {
    return { items: [], hasMore: false };
  },
};

export type { SwarmRunResponse };

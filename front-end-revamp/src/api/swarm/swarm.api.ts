import { apiClient } from "../client";
import type {
  SwarmCheckpointResponse,
  SwarmGraphListResponse,
  SwarmGraphMermaidResponse,
  SwarmResumeRequest,
  SwarmRunRequest,
  SwarmRunResponse,
  SwarmSessionResponse,
} from "./swarm.types";

const SWARM_BASE_PATH = "/api/v1/swarm";

export async function startSwarmRun(
  input: SwarmRunRequest,
): Promise<SwarmRunResponse> {
  const { data } = await apiClient.post<SwarmRunResponse>(
    `${SWARM_BASE_PATH}/run`,
    input,
  );
  return data;
}

export async function resumeSwarmRun(
  input: SwarmResumeRequest,
): Promise<SwarmRunResponse> {
  const { data } = await apiClient.post<SwarmRunResponse>(
    `${SWARM_BASE_PATH}/resume`,
    input,
  );
  return data;
}

export async function getSwarmState(
  threadId: string,
): Promise<SwarmCheckpointResponse> {
  const { data } = await apiClient.get<SwarmCheckpointResponse>(
    `${SWARM_BASE_PATH}/state/${encodeURIComponent(threadId)}`,
  );
  return data;
}

export async function getSwarmSession(
  threadId: string,
): Promise<SwarmSessionResponse> {
  const { data } = await apiClient.get<SwarmSessionResponse>(
    `${SWARM_BASE_PATH}/sessions/${encodeURIComponent(threadId)}`,
  );
  return data;
}

export async function listSwarmGraphs(): Promise<SwarmGraphListResponse> {
  const { data } = await apiClient.get<SwarmGraphListResponse>(
    `${SWARM_BASE_PATH}/graphs`,
  );
  return data;
}

export async function getSwarmGraphMermaid(
  graphId: string,
  options?: { xray?: boolean },
): Promise<SwarmGraphMermaidResponse> {
  const { data } = await apiClient.get<SwarmGraphMermaidResponse>(
    `${SWARM_BASE_PATH}/graphs/${encodeURIComponent(graphId)}/mermaid`,
    { params: { xray: options?.xray ?? false } },
  );
  return data;
}

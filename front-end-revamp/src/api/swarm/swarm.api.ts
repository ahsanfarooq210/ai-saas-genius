import { apiClient } from "../client";
import type {
  SwarmCheckpointResponse,
  SwarmGraphListResponse,
  SwarmGraphMermaidResponse,
  SwarmResumeRequest,
  SwarmReviseRequest,
  SwarmRevisionDetail,
  SwarmRevisionListResponse,
  SwarmRunRequest,
  SwarmRunResponse,
  SwarmSessionResponse,
} from "./swarm.types";

const SWARM_BASE_PATH = "/api/v1/swarm";
type RequestOptions = { signal?: AbortSignal };

export async function startSwarmRun(
  input: SwarmRunRequest,
  options?: RequestOptions,
): Promise<SwarmRunResponse> {
  const { data } = await apiClient.post<SwarmRunResponse>(
    `${SWARM_BASE_PATH}/run`,
    input,
    options,
  );
  return data;
}

export async function reviseSwarmRun(
  input: SwarmReviseRequest,
  options?: RequestOptions,
): Promise<SwarmRunResponse> {
  const { data } = await apiClient.post<SwarmRunResponse>(
    `${SWARM_BASE_PATH}/revise`,
    input,
    options,
  );
  return data;
}

export async function resumeSwarmRun(
  input: SwarmResumeRequest,
  options?: RequestOptions,
): Promise<SwarmRunResponse> {
  const { data } = await apiClient.post<SwarmRunResponse>(
    `${SWARM_BASE_PATH}/resume`,
    input,
    options,
  );
  return data;
}

export async function getSwarmState(
  threadId: string,
  options?: RequestOptions,
): Promise<SwarmCheckpointResponse> {
  const { data } = await apiClient.get<SwarmCheckpointResponse>(
    `${SWARM_BASE_PATH}/state/${encodeURIComponent(threadId)}`,
    options,
  );
  return data;
}

export async function getSwarmSession(
  threadId: string,
  options?: RequestOptions,
): Promise<SwarmSessionResponse> {
  const { data } = await apiClient.get<SwarmSessionResponse>(
    `${SWARM_BASE_PATH}/sessions/${encodeURIComponent(threadId)}`,
    options,
  );
  return data;
}

export async function listSwarmRevisions(
  threadId: string,
  options?: RequestOptions,
): Promise<SwarmRevisionListResponse> {
  const { data } = await apiClient.get<SwarmRevisionListResponse>(
    `${SWARM_BASE_PATH}/sessions/${encodeURIComponent(threadId)}/revisions`,
    options,
  );
  return data;
}

export async function getSwarmRevision(
  threadId: string,
  revisionNumber: number,
  options?: RequestOptions,
): Promise<SwarmRevisionDetail> {
  const { data } = await apiClient.get<SwarmRevisionDetail>(
    `${SWARM_BASE_PATH}/sessions/${encodeURIComponent(threadId)}/revisions/${revisionNumber}`,
    options,
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

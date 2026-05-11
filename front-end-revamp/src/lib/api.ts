import { axiosClient } from "./axios";
import type { SwarmRunRequest, SwarmRunResponse } from "@/features/swarm/types";

export interface HealthResponse {
  status: string;
}

export interface UserResponse {
  id: number;
  email: string;
  full_name: string;
  is_active: boolean;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export const api = {
  health: {
    check: async (): Promise<HealthResponse> => {
      const response = await axiosClient.get<HealthResponse>("/health/");
      return response.data;
    },
  },
  auth: {
    signup: async (data: any): Promise<UserResponse> => {
      const response = await axiosClient.post<UserResponse>("/auth/signup", data);
      return response.data;
    },
    signin: async (data: any): Promise<AuthTokens> => {
      const response = await axiosClient.post<AuthTokens>("/auth/signin", data);
      if (response.data.access_token) {
        localStorage.setItem("accessToken", response.data.access_token);
        localStorage.setItem("refreshToken", response.data.refresh_token);
      }
      return response.data;
    },
    refresh: async (refreshToken: string): Promise<AuthTokens> => {
      const response = await axiosClient.post<AuthTokens>("/auth/refresh", { refresh_token: refreshToken });
      if (response.data.access_token) {
        localStorage.setItem("accessToken", response.data.access_token);
        localStorage.setItem("refreshToken", response.data.refresh_token);
      }
      return response.data;
    },
    me: async (): Promise<UserResponse> => {
      const response = await axiosClient.get<UserResponse>("/auth/me");
      return response.data;
    },
  },
  agent: {
    getMermaidGraph: async (xray = false): Promise<{ mermaid: string }> => {
      const response = await axiosClient.get<{ mermaid: string }>("/agent/graph/mermaid", {
        params: { xray },
      });
      return response.data;
    },
    getImageGraphUrl: (xray = false): string => {
      // Return the URL directly to be used in <img src="..." />
      const baseUrl = axiosClient.defaults.baseURL || "";
      const params = new URLSearchParams();
      if (xray) params.append("xray", "true");
      return `${baseUrl}/agent/graph/image?${params.toString()}`;
    },
    run: async (payload: SwarmRunRequest): Promise<SwarmRunResponse> => {
      const response = await axiosClient.post<SwarmRunResponse>("/agent/run", payload);
      return response.data;
    },
  },
};

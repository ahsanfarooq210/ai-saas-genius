import { apiClient } from "../client";
import type {
  SignInRequest,
  SignUpRequest,
  TokenResponse,
  UserResponse,
} from "./auth.types";
import { clearAccessToken, setAccessToken } from "./access-token";

const AUTH_BASE_PATH = "/api/v1/auth";

function retainAccessToken(response: TokenResponse): TokenResponse {
  setAccessToken(response.access_token);
  return response;
}

export async function signUp(input: SignUpRequest): Promise<TokenResponse> {
  const { data } = await apiClient.post<TokenResponse>(
    `${AUTH_BASE_PATH}/signup`,
    input,
  );
  return retainAccessToken(data);
}

export async function signIn(input: SignInRequest): Promise<TokenResponse> {
  const { data } = await apiClient.post<TokenResponse>(
    `${AUTH_BASE_PATH}/signin`,
    input,
  );
  return retainAccessToken(data);
}

export async function logIn(input: SignInRequest): Promise<TokenResponse> {
  const { data } = await apiClient.post<TokenResponse>(
    `${AUTH_BASE_PATH}/login`,
    input,
  );
  return retainAccessToken(data);
}

export async function refreshAuth(): Promise<TokenResponse> {
  const { data } = await apiClient.post<TokenResponse>(
    `${AUTH_BASE_PATH}/refresh`,
  );
  return retainAccessToken(data);
}

export async function getCurrentUser(): Promise<UserResponse> {
  const { data } = await apiClient.get<UserResponse>(`${AUTH_BASE_PATH}/me`);
  return data;
}

export async function logout(): Promise<void> {
  try {
    await apiClient.post(`${AUTH_BASE_PATH}/logout`);
  } finally {
    clearAccessToken();
  }
}

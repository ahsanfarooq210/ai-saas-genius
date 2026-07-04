import { apiClient } from "../client";
import type {
  SignInRequest,
  SignUpRequest,
  TokenResponse,
  UserResponse,
} from "./auth.types";

const AUTH_BASE_PATH = "/api/v1/auth";

// Tokens are set by the backend as httpOnly cookies on every one of these
// calls; the JSON body is kept for backward compatibility only and should
// not be read or persisted client-side.

export async function signUp(input: SignUpRequest): Promise<TokenResponse> {
  const { data } = await apiClient.post<TokenResponse>(
    `${AUTH_BASE_PATH}/signup`,
    input,
  );
  return data;
}

export async function signIn(input: SignInRequest): Promise<TokenResponse> {
  const { data } = await apiClient.post<TokenResponse>(
    `${AUTH_BASE_PATH}/signin`,
    input,
  );
  return data;
}

export async function logIn(input: SignInRequest): Promise<TokenResponse> {
  const { data } = await apiClient.post<TokenResponse>(
    `${AUTH_BASE_PATH}/login`,
    input,
  );
  return data;
}

export async function refreshAuth(): Promise<TokenResponse> {
  const { data } = await apiClient.post<TokenResponse>(
    `${AUTH_BASE_PATH}/refresh`,
  );
  return data;
}

export async function getCurrentUser(): Promise<UserResponse> {
  const { data } = await apiClient.get<UserResponse>(`${AUTH_BASE_PATH}/me`);
  return data;
}

export async function logout(): Promise<void> {
  await apiClient.post(`${AUTH_BASE_PATH}/logout`);
}

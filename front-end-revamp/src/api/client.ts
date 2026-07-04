import axios, {
  type AxiosError,
  type InternalAxiosRequestConfig,
} from "axios";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, getCookie } from "./cookies";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

// Auth now travels as httpOnly cookies set by the backend; these paths are
// exempt from the 401-retry-with-refresh flow below to avoid recursive
// refresh attempts when the auth endpoints themselves fail.
const AUTH_ENDPOINTS_WITHOUT_REFRESH = [
  "/api/v1/auth/signin",
  "/api/v1/auth/signup",
  "/api/v1/auth/login",
  "/api/v1/auth/refresh",
  "/api/v1/auth/logout",
];

const SAFE_METHODS = new Set(["get", "head", "options"]);

interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

function attachCsrfHeader(
  config: InternalAxiosRequestConfig,
): InternalAxiosRequestConfig {
  const method = config.method?.toLowerCase();
  if (!method || SAFE_METHODS.has(method)) {
    return config;
  }

  const csrfToken = getCookie(CSRF_COOKIE_NAME);
  if (csrfToken) {
    config.headers.set(CSRF_HEADER_NAME, csrfToken);
  }
  return config;
}

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

// Dedicated instance for refresh calls so its own 401s never re-enter the
// response interceptor below and cause an infinite refresh loop.
const refreshClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

apiClient.interceptors.request.use(attachCsrfHeader);
refreshClient.interceptors.request.use(attachCsrfHeader);

let pendingRefresh: Promise<void> | null = null;

async function refreshSession(): Promise<void> {
  // No body needed: the refreshToken cookie is httpOnly and scoped to this
  // path, so the browser attaches it automatically.
  await refreshClient.post("/api/v1/auth/refresh");
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetryableRequestConfig | undefined;
    const status = error.response?.status;
    const isAuthEndpoint = AUTH_ENDPOINTS_WITHOUT_REFRESH.some((path) =>
      originalRequest?.url?.includes(path),
    );

    if (status !== 401 || !originalRequest || originalRequest._retry || isAuthEndpoint) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    try {
      pendingRefresh ??= refreshSession().finally(() => {
        pendingRefresh = null;
      });
      await pendingRefresh;
      // The refresh response set a new accessToken cookie; the browser will
      // attach it automatically on retry.
      return apiClient(originalRequest);
    } catch (refreshError) {
      return Promise.reject(refreshError);
    }
  },
);

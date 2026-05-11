import axios from "axios";

export const axiosClient = axios.create({
  baseURL: `${import.meta.env.VITE_SERVER_URL || "http://localhost:8000"}/api/v1`,
  withCredentials: true,
});

axiosClient.interceptors.request.use((config) => {
  const token = localStorage.getItem("accessToken");
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

axiosClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      originalRequest.url !== "/auth/refresh"
    ) {
      originalRequest._retry = true;
      try {
        const refreshToken = localStorage.getItem("refreshToken");
        if (!refreshToken) {
          throw new Error("No refresh token available");
        }
        
        // Use a new axios instance to avoid circular interceptors
        const response = await axios.post(
          `${axiosClient.defaults.baseURL}/auth/refresh`,
          { refresh_token: refreshToken },
          { withCredentials: true }
        );
        
        const { access_token, refresh_token } = response.data;
        localStorage.setItem("accessToken", access_token);
        localStorage.setItem("refreshToken", refresh_token);
        
        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${access_token}`;
        }
        
        return axiosClient(originalRequest);
      } catch (refreshError) {
        localStorage.removeItem("accessToken");
        localStorage.removeItem("refreshToken");
        // Optionally redirect to login or handle logout here
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  },
);

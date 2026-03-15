import axios from "axios";

export const axiosClient = axios.create({
  baseURL: import.meta.env.VITE_SERVER_URL || "http://localhost:5000/api",
  withCredentials: true,
});

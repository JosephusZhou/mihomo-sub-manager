import axios from 'axios';
import { useAuthStore } from '@/stores/auth';
import { API_BASE_URL } from '@/config';

const baseConfig = {
  baseURL: `${API_BASE_URL}/api`,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
};

const api = axios.create(baseConfig);

// 刷新专用实例：不挂任何拦截器，避免 /auth/refresh 自身的 401 再次触发刷新。
export const refreshApi = axios.create(baseConfig);

api.interceptors.request.use((config) => {
  const auth = useAuthStore();
  if (auth.accessToken) {
    config.headers.Authorization = `Bearer ${auth.accessToken}`;
    config._requestToken = auth.accessToken;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status !== 401 || !originalRequest) {
      return Promise.reject(error);
    }

    // 登录与刷新请求不参与 401 重试，避免刷新失败时递归刷新。
    if (originalRequest.skipAuthRefresh || originalRequest._retry) {
      return Promise.reject(error);
    }

    const auth = useAuthStore();

    // 请求发出后 token 已被主动刷新替换，直接用新 token 重试一次，无需再次刷新。
    if (
      originalRequest._requestToken &&
      originalRequest._requestToken !== auth.accessToken &&
      auth.accessToken
    ) {
      originalRequest._retry = true;
      originalRequest.headers.Authorization = `Bearer ${auth.accessToken}`;
      return api(originalRequest);
    }

    if (!auth.refreshToken) {
      auth.forceRelogin();
      return Promise.reject(error);
    }

    originalRequest._retry = true;
    try {
      await auth.ensureRefreshed();
      originalRequest.headers.Authorization = `Bearer ${auth.accessToken}`;
      return api(originalRequest);
    } catch (refreshError) {
      // 只有刷新本身失败才登出并跳转；重试后仍 401 的请求直接抛给调用方。
      auth.forceRelogin();
      return Promise.reject(refreshError);
    }
  }
);

export default api;

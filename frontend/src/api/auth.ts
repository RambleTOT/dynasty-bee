import { api } from './client';
import type { LoginIn, LoginOut, UserOut } from './types';

/** Вход и сессия (FRONTEND_AGENT_GUIDE §1). */
export const authApi = {
  login: (body: LoginIn) => api.post<LoginOut>('/auth/login', body),
  me: (signal?: AbortSignal) => api.get<UserOut>('/auth/me', { signal }),
  logout: () => api.post<void>('/auth/logout'),
};

import type { MeResponse, SessionSummary } from '@pm/types';
import { api } from '@/lib/api-client';

export interface RegisterPayload {
  organizationName: string;
  fullName: string;
  email: string;
  password: string;
}

export const authApi = {
  me: () => api.get<MeResponse>('/auth/me'),
  login: (email: string, password: string) => api.post<MeResponse>('/auth/login', { email, password }),
  register: (payload: RegisterPayload) => api.post<MeResponse>('/auth/register', payload),
  logout: () => api.post<void>('/auth/logout'),
  logoutAll: () => api.post<{ revoked: number }>('/auth/logout-all'),
  forgotPassword: (email: string) => api.post<{ message: string }>('/auth/forgot-password', { email }),
  resetPassword: (token: string, password: string) =>
    api.post<{ message: string }>('/auth/reset-password', { token, password }),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<{ message: string }>('/auth/change-password', { currentPassword, newPassword }),
  verifyEmail: (token: string) => api.post<{ message: string }>('/auth/verify-email', { token }),
  resendVerification: () => api.post<{ message: string }>('/auth/resend-verification'),
  updateProfile: (payload: { fullName?: string; phone?: string }) =>
    api.patch<MeResponse>('/auth/profile', payload),
  sessions: () => api.get<SessionSummary[]>('/auth/sessions'),
  revokeSession: (id: string) => api.delete<void>(`/auth/sessions/${id}`),
};

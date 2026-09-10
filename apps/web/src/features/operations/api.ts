import type { Paginated } from '@pm/types';
import { api, apiDownload } from '@/lib/api-client';
import type {
  AuditEntry,
  DocumentRecord,
  MaintenanceDetail,
  MaintenanceRequest,
  MaintenanceSummary,
  MaintenanceUpdateEntry,
  NotificationRecord,
  StaffInvite,
  StaffMember,
  StaffProperties,
} from './types';

type Query = Record<string, string | number | boolean | undefined>;

export const operationsApi = {
  maintenance: {
    list: (query: Query) =>
      api.get<Paginated<MaintenanceRequest> & { openCount: number }>('/maintenance', { query }),
    get: (id: string) => api.get<MaintenanceDetail>(`/maintenance/${id}`),
    summary: () => api.get<MaintenanceSummary>('/maintenance/summary'),
    create: (body: unknown) => api.post<MaintenanceDetail>('/maintenance', body),
    update: (id: string, body: unknown) => api.patch<MaintenanceDetail>(`/maintenance/${id}`, body),
    assign: (id: string, body: unknown) =>
      api.post<MaintenanceDetail>(`/maintenance/${id}/assign`, body),
    changeStatus: (id: string, body: unknown) =>
      api.post<MaintenanceDetail>(`/maintenance/${id}/status`, body),
    addUpdate: (id: string, body: unknown) =>
      api.post<MaintenanceDetail>(`/maintenance/${id}/updates`, body),
    updates: (id: string) => api.get<MaintenanceUpdateEntry[]>(`/maintenance/${id}/updates`),
  },
  staff: {
    list: (query: Query) => api.get<Paginated<StaffMember>>('/staff', { query }),
    get: (id: string) => api.get<StaffMember>(`/staff/${id}`),
    properties: (id: string) => api.get<StaffProperties>(`/staff/${id}/properties`),
    /** The invite link is in this response and nowhere else, ever. */
    create: (body: unknown) => api.post<StaffInvite>('/staff', body),
    update: (id: string, body: unknown) => api.patch<StaffMember>(`/staff/${id}`, body),
    assignProperties: (id: string, propertyIds: string[]) =>
      api.put<StaffProperties>(`/staff/${id}/properties`, { propertyIds }),
    activate: (id: string) => api.post<StaffMember>(`/staff/${id}/activate`),
    deactivate: (id: string) => api.post<StaffMember>(`/staff/${id}/deactivate`),
    remove: (id: string) => api.delete<void>(`/staff/${id}`),
  },
  documents: {
    list: (query: Query) => api.get<Paginated<DocumentRecord>>('/documents', { query }),
    get: (id: string) => api.get<DocumentRecord>(`/documents/${id}`),
    upload: (form: FormData) => api.post<DocumentRecord>('/documents', form),
    download: (id: string) => apiDownload(`/documents/${id}/download`),
    remove: (id: string) => api.delete<void>(`/documents/${id}`),
  },
  notifications: {
    list: (query: Query) =>
      api.get<Paginated<NotificationRecord> & { unreadCount: number }>('/notifications', { query }),
    unreadCount: () => api.get<{ count: number }>('/notifications/unread-count'),
    markRead: (id: string) => api.post<{ count: number }>(`/notifications/${id}/read`),
    markAllRead: () => api.post<{ marked: number; count: number }>('/notifications/read-all'),
  },
  auditLogs: {
    list: (query: Query) => api.get<Paginated<AuditEntry>>('/audit-logs', { query }),
    actions: () => api.get<string[]>('/audit-logs/actions'),
  },
};

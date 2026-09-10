import type { Paginated } from '@pm/types';
import { api } from '@/lib/api-client';
import type { Lease, Tenant, TenantProfile } from './types';

type Query = Record<string, string | number | boolean | undefined>;

export const occupancyApi = {
  tenants: {
    list: (query: Query) => api.get<Paginated<Tenant>>('/tenants', { query }),
    get: (id: string) => api.get<Tenant>(`/tenants/${id}`),
    profile: (id: string) => api.get<TenantProfile>(`/tenants/${id}/profile`),
    create: (body: unknown) => api.post<Tenant>('/tenants', body),
    update: (id: string, body: unknown) => api.patch<Tenant>(`/tenants/${id}`, body),
    remove: (id: string) => api.delete<void>(`/tenants/${id}`),
  },
  leases: {
    list: (query: Query) => api.get<Paginated<Lease>>('/leases', { query }),
    get: (id: string) => api.get<Lease>(`/leases/${id}`),
    expiring: (days: number) =>
      api.get<{ days: number; data: Lease[] }>('/leases/expiring', { query: { days } }),
    create: (body: unknown) => api.post<Lease>('/leases', body),
    update: (id: string, body: unknown) => api.patch<Lease>(`/leases/${id}`, body),
    renew: (id: string, body: unknown) => api.post<Lease>(`/leases/${id}/renew`, body),
    terminate: (id: string, body: unknown) => api.post<Lease>(`/leases/${id}/terminate`, body),
  },
};

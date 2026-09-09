import type { Paginated } from '@pm/types';
import { api } from '@/lib/api-client';
import type { Building, Property, PropertySummary, Unit } from './types';

type Query = Record<string, string | number | boolean | undefined>;

export const portfolioApi = {
  properties: {
    list: (query: Query) => api.get<Paginated<Property>>('/properties', { query }),
    get: (id: string) => api.get<Property>(`/properties/${id}`),
    summary: (id: string) => api.get<PropertySummary>(`/properties/${id}/summary`),
    create: (body: unknown) => api.post<Property>('/properties', body),
    update: (id: string, body: unknown) => api.patch<Property>(`/properties/${id}`, body),
    archive: (id: string) => api.post<Property>(`/properties/${id}/archive`),
    remove: (id: string) => api.delete<void>(`/properties/${id}`),
  },
  buildings: {
    list: (query: Query) => api.get<Paginated<Building>>('/buildings', { query }),
    get: (id: string) => api.get<Building>(`/buildings/${id}`),
    create: (body: unknown) => api.post<Building>('/buildings', body),
    update: (id: string, body: unknown) => api.patch<Building>(`/buildings/${id}`, body),
    remove: (id: string) => api.delete<{ detachedUnits: number }>(`/buildings/${id}`),
  },
  units: {
    list: (query: Query) => api.get<Paginated<Unit>>('/units', { query }),
    get: (id: string) => api.get<Unit>(`/units/${id}`),
    vacant: (propertyId?: string) => api.get<Unit[]>('/units/vacant', { query: { propertyId } }),
    create: (body: unknown) => api.post<Unit>('/units', body),
    update: (id: string, body: unknown) => api.patch<Unit>(`/units/${id}`, body),
    setStatus: (id: string, body: unknown) => api.patch<Unit>(`/units/${id}/status`, body),
    remove: (id: string) => api.delete<void>(`/units/${id}`),
  },
};

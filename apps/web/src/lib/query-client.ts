import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api-client';

/**
 * TanStack Query is the only server-state cache in the app. Nothing fetches in
 * a useEffect, and nothing copies server data into component state.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => {
          // Retrying an authorization failure just delays the real message.
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}

/**
 * Query keys in one place so a mutation can invalidate precisely rather than
 * blowing away the whole cache.
 */
export const queryKeys = {
  me: ['auth', 'me'] as const,
  sessions: ['auth', 'sessions'] as const,
  organization: ['organization'] as const,
  settings: ['settings'] as const,
  users: (params: Record<string, unknown> = {}) => ['users', params] as const,
  roles: ['roles'] as const,

  properties: (params: Record<string, unknown> = {}) => ['properties', params] as const,
  property: (id: string) => ['properties', 'detail', id] as const,
  propertySummary: (id: string) => ['properties', 'summary', id] as const,
  buildings: (params: Record<string, unknown> = {}) => ['buildings', params] as const,
  building: (id: string) => ['buildings', 'detail', id] as const,
  units: (params: Record<string, unknown> = {}) => ['units', params] as const,
  unit: (id: string) => ['units', 'detail', id] as const,
  vacantUnits: (propertyId?: string) => ['units', 'vacant', propertyId ?? 'all'] as const,

  tenants: (params: Record<string, unknown> = {}) => ['tenants', params] as const,
  tenant: (id: string) => ['tenants', 'detail', id] as const,
  tenantProfile: (id: string) => ['tenants', 'profile', id] as const,
  leases: (params: Record<string, unknown> = {}) => ['leases', params] as const,
  lease: (id: string) => ['leases', 'detail', id] as const,
  expiringLeases: (days: number) => ['leases', 'expiring', days] as const,

  rent: (params: Record<string, unknown> = {}) => ['rent', params] as const,
  rentRecord: (id: string) => ['rent', 'detail', id] as const,
  rentSummary: (params: Record<string, unknown> = {}) => ['rent', 'summary', params] as const,
  outstandingRent: (params: Record<string, unknown> = {}) => ['rent', 'outstanding', params] as const,
  payments: (params: Record<string, unknown> = {}) => ['payments', params] as const,
  payment: (id: string) => ['payments', 'detail', id] as const,
  receipts: (params: Record<string, unknown> = {}) => ['receipts', params] as const,
  receipt: (id: string) => ['receipts', 'detail', id] as const,
  expenses: (params: Record<string, unknown> = {}) => ['expenses', params] as const,
  expense: (id: string) => ['expenses', 'detail', id] as const,
  expenseSummary: (params: Record<string, unknown> = {}) => ['expenses', 'summary', params] as const,
};

/**
 * Portfolio mutations touch counts on other screens: creating a unit changes
 * its property's unit count and its building's. Invalidating the three roots
 * together keeps every visible number honest without hand-listing keys at each
 * call site.
 */
export const PORTFOLIO_ROOTS = [['properties'], ['buildings'], ['units']] as const;

/**
 * Occupancy writes ripple further than the portfolio ones: creating a lease
 * changes a unit's status and a property's occupancy rate, so the portfolio
 * roots are invalidated alongside the occupancy ones.
 */
export const OCCUPANCY_ROOTS = [
  ['tenants'],
  ['leases'],
  ['units'],
  ['properties'],
  ['buildings'],
] as const;

/**
 * Recording a payment changes the rent roll, the payments list, the receipt
 * register and the tenant's profile at once. Invalidating all of them together
 * is what stops one screen showing a balance another screen has already
 * collected.
 */
export const FINANCE_ROOTS = [
  ['rent'],
  ['payments'],
  ['receipts'],
  ['expenses'],
  ['tenants'],
  ['leases'],
] as const;

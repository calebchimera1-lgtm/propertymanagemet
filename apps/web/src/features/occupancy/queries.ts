'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { OCCUPANCY_ROOTS, queryKeys } from '@/lib/query-client';
import { occupancyApi } from './api';

type Query = Record<string, string | number | boolean | undefined>;

/**
 * A lease change moves a unit's status and a property's occupancy rate, so the
 * portfolio caches are invalidated with the occupancy ones. Anything less and
 * the units screen keeps showing "vacant" for a unit somebody just moved into.
 */
function useOccupancyInvalidation() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of OCCUPANCY_ROOTS) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };
}

/** @param enabled Skip the request until a tenant list is actually needed. */
export function useTenants(query: Query, enabled = true) {
  return useQuery({
    queryKey: queryKeys.tenants(query),
    queryFn: () => occupancyApi.tenants.list(query),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useTenantProfile(id: string) {
  return useQuery({
    queryKey: queryKeys.tenantProfile(id),
    queryFn: () => occupancyApi.tenants.profile(id),
    enabled: Boolean(id),
  });
}

export function useLeases(query: Query) {
  return useQuery({
    queryKey: queryKeys.leases(query),
    queryFn: () => occupancyApi.leases.list(query),
    placeholderData: keepPreviousData,
  });
}

export function useLease(id: string) {
  return useQuery({
    queryKey: queryKeys.lease(id),
    queryFn: () => occupancyApi.leases.get(id),
    enabled: Boolean(id),
  });
}

export function useExpiringLeases(days = 60) {
  return useQuery({
    queryKey: queryKeys.expiringLeases(days),
    queryFn: () => occupancyApi.leases.expiring(days),
  });
}

export function useTenantMutations() {
  const invalidate = useOccupancyInvalidation();

  return {
    create: useMutation({ mutationFn: occupancyApi.tenants.create, onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: unknown }) =>
        occupancyApi.tenants.update(id, body),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: occupancyApi.tenants.remove, onSuccess: invalidate }),
  };
}

export function useLeaseMutations() {
  const invalidate = useOccupancyInvalidation();

  return {
    create: useMutation({ mutationFn: occupancyApi.leases.create, onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: unknown }) =>
        occupancyApi.leases.update(id, body),
      onSuccess: invalidate,
    }),
    renew: useMutation({
      mutationFn: ({ id, body }: { id: string; body: unknown }) =>
        occupancyApi.leases.renew(id, body),
      onSuccess: invalidate,
    }),
    terminate: useMutation({
      mutationFn: ({ id, body }: { id: string; body: unknown }) =>
        occupancyApi.leases.terminate(id, body),
      onSuccess: invalidate,
    }),
  };
}

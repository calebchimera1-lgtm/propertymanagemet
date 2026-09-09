'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PORTFOLIO_ROOTS, queryKeys } from '@/lib/query-client';
import { portfolioApi } from './api';

type Query = Record<string, string | number | boolean | undefined>;

/** Invalidates every portfolio list and detail after a write. */
function usePortfolioInvalidation() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of PORTFOLIO_ROOTS) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };
}

export function useProperties(query: Query) {
  return useQuery({
    queryKey: queryKeys.properties(query),
    queryFn: () => portfolioApi.properties.list(query),
    placeholderData: keepPreviousData,
  });
}

export function useProperty(id: string) {
  return useQuery({
    queryKey: queryKeys.property(id),
    queryFn: () => portfolioApi.properties.get(id),
    enabled: Boolean(id),
  });
}

export function usePropertySummary(id: string) {
  return useQuery({
    queryKey: queryKeys.propertySummary(id),
    queryFn: () => portfolioApi.properties.summary(id),
    enabled: Boolean(id),
  });
}

export function useBuildings(query: Query, enabled = true) {
  return useQuery({
    queryKey: queryKeys.buildings(query),
    queryFn: () => portfolioApi.buildings.list(query),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useBuilding(id: string) {
  return useQuery({
    queryKey: queryKeys.building(id),
    queryFn: () => portfolioApi.buildings.get(id),
    enabled: Boolean(id),
  });
}

export function useUnits(query: Query) {
  return useQuery({
    queryKey: queryKeys.units(query),
    queryFn: () => portfolioApi.units.list(query),
    placeholderData: keepPreviousData,
  });
}

export function useUnit(id: string) {
  return useQuery({
    queryKey: queryKeys.unit(id),
    queryFn: () => portfolioApi.units.get(id),
    enabled: Boolean(id),
  });
}

export function usePropertyMutations() {
  const invalidate = usePortfolioInvalidation();

  return {
    create: useMutation({ mutationFn: portfolioApi.properties.create, onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: unknown }) =>
        portfolioApi.properties.update(id, body),
      onSuccess: invalidate,
    }),
    archive: useMutation({ mutationFn: portfolioApi.properties.archive, onSuccess: invalidate }),
    remove: useMutation({ mutationFn: portfolioApi.properties.remove, onSuccess: invalidate }),
  };
}

export function useBuildingMutations() {
  const invalidate = usePortfolioInvalidation();

  return {
    create: useMutation({ mutationFn: portfolioApi.buildings.create, onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: unknown }) =>
        portfolioApi.buildings.update(id, body),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: portfolioApi.buildings.remove, onSuccess: invalidate }),
  };
}

export function useUnitMutations() {
  const invalidate = usePortfolioInvalidation();

  return {
    create: useMutation({ mutationFn: portfolioApi.units.create, onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: unknown }) =>
        portfolioApi.units.update(id, body),
      onSuccess: invalidate,
    }),
    setStatus: useMutation({
      mutationFn: ({ id, body }: { id: string; body: unknown }) =>
        portfolioApi.units.setStatus(id, body),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: portfolioApi.units.remove, onSuccess: invalidate }),
  };
}

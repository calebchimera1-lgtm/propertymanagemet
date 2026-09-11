'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-client';
import { insightsApi } from './api';

type Query = Record<string, string | number | boolean | undefined>;

export function useDashboardSummary(query: Query) {
  return useQuery({
    queryKey: queryKeys.dashboardSummary(query),
    queryFn: () => insightsApi.dashboard.summary(query),
    placeholderData: keepPreviousData,
  });
}

export function useDashboardCharts(query: Query) {
  return useQuery({
    queryKey: queryKeys.dashboardCharts(query),
    queryFn: () => insightsApi.dashboard.charts(query),
    placeholderData: keepPreviousData,
  });
}

export function useWorklists() {
  return useQuery({
    queryKey: queryKeys.worklists,
    queryFn: () => insightsApi.dashboard.worklists(),
  });
}

export function useReportCatalogue() {
  return useQuery({
    queryKey: queryKeys.reportCatalogue,
    queryFn: () => insightsApi.reports.catalogue(),
    // The catalogue is code, not data: it only changes when the app is deployed.
    staleTime: 10 * 60_000,
  });
}

export function useReport(key: string, query: Query, enabled = true) {
  return useQuery({
    queryKey: queryKeys.report(key, query),
    queryFn: () => insightsApi.reports.run(key, query),
    enabled: Boolean(key) && enabled,
    placeholderData: keepPreviousData,
  });
}

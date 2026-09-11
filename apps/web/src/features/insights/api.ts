import { api, apiDownload } from '@/lib/api-client';
import type {
  DashboardCharts,
  DashboardSummary,
  ReportCatalogueEntry,
  ReportResult,
  Worklists,
} from './types';

type Query = Record<string, string | number | boolean | undefined>;

export const insightsApi = {
  dashboard: {
    summary: (query: Query) => api.get<DashboardSummary>('/dashboard/summary', { query }),
    charts: (query: Query) => api.get<DashboardCharts>('/dashboard/charts', { query }),
    worklists: () => api.get<Worklists>('/dashboard/worklists'),
  },
  reports: {
    catalogue: () => api.get<ReportCatalogueEntry[]>('/reports'),
    run: (key: string, query: Query) => api.get<ReportResult>(`/reports/${key}`, { query }),
    /**
     * Fetched with the session cookie like any other call, because an export
     * runs the same guards as the screen — a plain link would be anonymous.
     */
    export: (key: string, query: Query) => {
      const params = new URLSearchParams();
      for (const [name, value] of Object.entries(query)) {
        if (value !== undefined && value !== '') params.set(name, String(value));
      }
      return apiDownload(`/reports/${key}/export?${params.toString()}`);
    },
  },
};

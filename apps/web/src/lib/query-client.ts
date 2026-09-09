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
};

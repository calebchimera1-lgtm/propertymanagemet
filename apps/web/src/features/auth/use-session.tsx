'use client';

import { useQuery } from '@tanstack/react-query';
import type { MeResponse, Permission } from '@pm/types';
import { ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-client';
import { authApi } from './api';

export interface SessionState {
  me: MeResponse | undefined;
  isLoading: boolean;
  isSignedIn: boolean;
  /**
   * Whether the UI should show a control. This is a courtesy only — the API
   * re-checks every permission on every request, so hiding a button is never
   * what keeps an action safe.
   */
  can: (permission: Permission) => boolean;
  canAny: (...permissions: Permission[]) => boolean;
}

export function useSession(): SessionState {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.me,
    queryFn: authApi.me,
    retry: (failureCount, error) => {
      // A 401 means "not signed in", not "try again".
      if (error instanceof ApiError && error.isUnauthenticated) return false;
      return failureCount < 1;
    },
    staleTime: 60_000,
  });

  const held = new Set<string>(data?.permissions ?? []);

  return {
    me: data,
    isLoading,
    isSignedIn: Boolean(data),
    can: (permission) => held.has(permission),
    canAny: (...permissions) => permissions.some((permission) => held.has(permission)),
  };
}

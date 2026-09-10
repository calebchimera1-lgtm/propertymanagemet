'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DOCUMENT_ROOTS,
  MAINTENANCE_ROOTS,
  STAFF_ROOTS,
  queryKeys,
} from '@/lib/query-client';
import { operationsApi } from './api';

type Query = Record<string, string | number | boolean | undefined>;

function useInvalidation(roots: readonly (readonly string[])[]) {
  const queryClient = useQueryClient();
  return () => {
    for (const key of roots) void queryClient.invalidateQueries({ queryKey: key });
  };
}

// ── Maintenance ──────────────────────────────────────────────────────────────

export function useMaintenanceList(query: Query) {
  return useQuery({
    queryKey: queryKeys.maintenance(query),
    queryFn: () => operationsApi.maintenance.list(query),
    placeholderData: keepPreviousData,
  });
}

export function useMaintenanceRequest(id: string) {
  return useQuery({
    queryKey: queryKeys.maintenanceRequest(id),
    queryFn: () => operationsApi.maintenance.get(id),
    enabled: Boolean(id),
  });
}

export function useMaintenanceSummary() {
  return useQuery({
    queryKey: queryKeys.maintenanceSummary,
    queryFn: () => operationsApi.maintenance.summary(),
  });
}

export function useMaintenanceMutations() {
  const invalidate = useInvalidation(MAINTENANCE_ROOTS);
  return {
    create: useMutation({ mutationFn: operationsApi.maintenance.create, onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: unknown }) =>
        operationsApi.maintenance.update(id, body),
      onSuccess: invalidate,
    }),
    assign: useMutation({
      mutationFn: ({ id, body }: { id: string; body: unknown }) =>
        operationsApi.maintenance.assign(id, body),
      onSuccess: invalidate,
    }),
    changeStatus: useMutation({
      mutationFn: ({ id, body }: { id: string; body: unknown }) =>
        operationsApi.maintenance.changeStatus(id, body),
      onSuccess: invalidate,
    }),
    addUpdate: useMutation({
      mutationFn: ({ id, body }: { id: string; body: unknown }) =>
        operationsApi.maintenance.addUpdate(id, body),
      onSuccess: invalidate,
    }),
  };
}

// ── Staff ────────────────────────────────────────────────────────────────────

export function useStaffList(query: Query) {
  return useQuery({
    queryKey: queryKeys.staff(query),
    queryFn: () => operationsApi.staff.list(query),
    placeholderData: keepPreviousData,
  });
}

export function useStaffProperties(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.staffProperties(id),
    queryFn: () => operationsApi.staff.properties(id),
    enabled: Boolean(id) && enabled,
  });
}

export function useStaffMutations() {
  const invalidate = useInvalidation(STAFF_ROOTS);
  return {
    create: useMutation({ mutationFn: operationsApi.staff.create, onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: unknown }) =>
        operationsApi.staff.update(id, body),
      onSuccess: invalidate,
    }),
    assignProperties: useMutation({
      mutationFn: ({ id, propertyIds }: { id: string; propertyIds: string[] }) =>
        operationsApi.staff.assignProperties(id, propertyIds),
      onSuccess: invalidate,
    }),
    setActive: useMutation({
      mutationFn: ({ id, active }: { id: string; active: boolean }) =>
        active ? operationsApi.staff.activate(id) : operationsApi.staff.deactivate(id),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: operationsApi.staff.remove, onSuccess: invalidate }),
  };
}

// ── Documents ────────────────────────────────────────────────────────────────

export function useDocuments(query: Query) {
  return useQuery({
    queryKey: queryKeys.documents(query),
    queryFn: () => operationsApi.documents.list(query),
    placeholderData: keepPreviousData,
  });
}

export function useDocumentMutations() {
  const invalidate = useInvalidation(DOCUMENT_ROOTS);
  return {
    upload: useMutation({ mutationFn: operationsApi.documents.upload, onSuccess: invalidate }),
    remove: useMutation({ mutationFn: operationsApi.documents.remove, onSuccess: invalidate }),
  };
}

// ── Notifications ────────────────────────────────────────────────────────────

export function useNotifications(query: Query) {
  return useQuery({
    queryKey: queryKeys.notifications(query),
    queryFn: () => operationsApi.notifications.list(query),
    placeholderData: keepPreviousData,
  });
}

/**
 * The topbar badge.
 *
 * Polled every 60 seconds rather than pushed. A WebSocket for a number that
 * changes a few times a day would be operational cost with no user-visible
 * benefit, and this contract can become SSE later without touching callers.
 */
export function useUnreadNotifications() {
  return useQuery({
    queryKey: queryKeys.unreadNotifications,
    queryFn: () => operationsApi.notifications.unreadCount(),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
}

export function useNotificationMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };
  return {
    markRead: useMutation({
      mutationFn: operationsApi.notifications.markRead,
      onSuccess: invalidate,
    }),
    markAllRead: useMutation({
      mutationFn: operationsApi.notifications.markAllRead,
      onSuccess: invalidate,
    }),
  };
}

// ── Audit log ────────────────────────────────────────────────────────────────

export function useAuditLogs(query: Query) {
  return useQuery({
    queryKey: queryKeys.auditLogs(query),
    queryFn: () => operationsApi.auditLogs.list(query),
    placeholderData: keepPreviousData,
  });
}

export function useAuditActions() {
  return useQuery({
    queryKey: queryKeys.auditActions,
    queryFn: () => operationsApi.auditLogs.actions(),
    staleTime: 5 * 60_000,
  });
}

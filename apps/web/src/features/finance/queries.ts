'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FINANCE_ROOTS, queryKeys } from '@/lib/query-client';
import { financeApi } from './api';

type Query = Record<string, string | number | boolean | undefined>;

function useFinanceInvalidation() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of FINANCE_ROOTS) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };
}

export function useRentRoll(query: Query) {
  return useQuery({
    queryKey: queryKeys.rent(query),
    queryFn: () => financeApi.rent.list(query),
    placeholderData: keepPreviousData,
  });
}

export function useRentRecord(id: string) {
  return useQuery({
    queryKey: queryKeys.rentRecord(id),
    queryFn: () => financeApi.rent.get(id),
    enabled: Boolean(id),
  });
}

export function useRentSummary(query: Query) {
  return useQuery({
    queryKey: queryKeys.rentSummary(query),
    queryFn: () => financeApi.rent.summary(query),
  });
}

export function useOutstandingRent(query: Query) {
  return useQuery({
    queryKey: queryKeys.outstandingRent(query),
    queryFn: () => financeApi.rent.outstanding(query),
    placeholderData: keepPreviousData,
  });
}

export function usePayments(query: Query) {
  return useQuery({
    queryKey: queryKeys.payments(query),
    queryFn: () => financeApi.payments.list(query),
    placeholderData: keepPreviousData,
  });
}

export function useReceipts(query: Query) {
  return useQuery({
    queryKey: queryKeys.receipts(query),
    queryFn: () => financeApi.receipts.list(query),
    placeholderData: keepPreviousData,
  });
}

export function useReceipt(id: string) {
  return useQuery({
    queryKey: queryKeys.receipt(id),
    queryFn: () => financeApi.receipts.get(id),
    enabled: Boolean(id),
  });
}

export function useExpenses(query: Query) {
  return useQuery({
    queryKey: queryKeys.expenses(query),
    queryFn: () => financeApi.expenses.list(query),
    placeholderData: keepPreviousData,
  });
}

export function useExpenseSummary(query: Query) {
  return useQuery({
    queryKey: queryKeys.expenseSummary(query),
    queryFn: () => financeApi.expenses.summary(query),
  });
}

export function useRentMutations() {
  const invalidate = useFinanceInvalidation();
  return {
    generate: useMutation({ mutationFn: financeApi.rent.generate, onSuccess: invalidate }),
  };
}

export function usePaymentMutations() {
  const invalidate = useFinanceInvalidation();
  return {
    create: useMutation({
      mutationFn: ({ body, key }: { body: unknown; key: string }) =>
        financeApi.payments.create(body, key),
      onSuccess: invalidate,
    }),
    void: useMutation({
      mutationFn: ({ id, body }: { id: string; body: unknown }) =>
        financeApi.payments.void(id, body),
      onSuccess: invalidate,
    }),
  };
}

export function useExpenseMutations() {
  const invalidate = useFinanceInvalidation();
  return {
    create: useMutation({ mutationFn: financeApi.expenses.create, onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: unknown }) =>
        financeApi.expenses.update(id, body),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: financeApi.expenses.remove, onSuccess: invalidate }),
  };
}

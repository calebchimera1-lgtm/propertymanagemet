import type { Paginated } from '@pm/types';
import { api } from '@/lib/api-client';
import type {
  Expense,
  ExpenseSummary,
  Payment,
  Receipt,
  RentRecord,
  RentRecordDetail,
  RentSummary,
} from './types';

type Query = Record<string, string | number | boolean | undefined>;

export const financeApi = {
  rent: {
    list: (query: Query) => api.get<Paginated<RentRecord>>('/rent', { query }),
    get: (id: string) => api.get<RentRecordDetail>(`/rent/${id}`),
    outstanding: (query: Query) =>
      api.get<Paginated<RentRecord> & { totalOutstanding: string }>('/rent/outstanding', { query }),
    summary: (query: Query) => api.get<RentSummary>('/rent/summary', { query }),
    generate: (body: unknown) =>
      api.post<{ periodLabel: string; created: number; skipped: number; expiredLeasesSkipped: number }>(
        '/rent/generate',
        body,
      ),
  },
  payments: {
    list: (query: Query) =>
      api.get<Paginated<Payment> & { totalAmount: string }>('/payments', { query }),
    get: (id: string) => api.get<Payment>(`/payments/${id}`),
    /**
     * The idempotency key is generated per submit attempt, so a retry after a
     * dropped connection replays the original rather than taking the money
     * twice.
     */
    create: (body: unknown, idempotencyKey: string) =>
      api.post<Payment & { receipt: { id: string; receiptNumber: string } }>('/payments', body, {
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    void: (id: string, body: unknown) => api.post<Payment>(`/payments/${id}/void`, body),
  },
  receipts: {
    list: (query: Query) => api.get<Paginated<Receipt>>('/receipts', { query }),
    get: (id: string) => api.get<Receipt>(`/receipts/${id}`),
  },
  expenses: {
    list: (query: Query) =>
      api.get<Paginated<Expense> & { totalAmount: string }>('/expenses', { query }),
    get: (id: string) => api.get<Expense>(`/expenses/${id}`),
    summary: (query: Query) => api.get<ExpenseSummary>('/expenses/summary', { query }),
    create: (body: unknown) => api.post<Expense>('/expenses', body),
    update: (id: string, body: unknown) => api.patch<Expense>(`/expenses/${id}`, body),
    remove: (id: string) => api.delete<void>(`/expenses/${id}`),
  },
};

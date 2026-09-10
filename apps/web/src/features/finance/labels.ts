import type { ExpenseCategory, PaymentMethod, RentStatus } from './types';

type BadgeVariant = 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'info' | 'outline';

export const RENT_STATUS_LABELS: Record<RentStatus, string> = {
  PENDING: 'Pending',
  PARTIALLY_PAID: 'Part paid',
  PAID: 'Paid',
  OVERDUE: 'Overdue',
};

/**
 * Overdue is the only red in this set. Pending is neutral — rent not yet due is
 * not a problem, and colouring it as one trains people to ignore the colour.
 */
export const RENT_STATUS_VARIANTS: Record<RentStatus, BadgeVariant> = {
  PENDING: 'secondary',
  PARTIALLY_PAID: 'warning',
  PAID: 'success',
  OVERDUE: 'destructive',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  MPESA: 'M-Pesa',
  BANK: 'Bank transfer',
  CASH: 'Cash',
  CHEQUE: 'Cheque',
  OTHER: 'Other',
};

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  MAINTENANCE: 'Maintenance',
  REPAIRS: 'Repairs',
  SECURITY: 'Security',
  CLEANING: 'Cleaning',
  WATER: 'Water',
  ELECTRICITY: 'Electricity',
  GARBAGE: 'Garbage',
  SALARIES: 'Salaries',
  INSURANCE: 'Insurance',
  TAXES: 'Taxes',
  MANAGEMENT: 'Management',
  CONSTRUCTION: 'Construction',
  OTHER: 'Other',
};

export function overdueLabel(daysOverdue: number): string {
  if (daysOverdue <= 0) return '';
  return `${daysOverdue} day${daysOverdue === 1 ? '' : 's'} late`;
}

/** "2026-09" → "September 2026". */
export function periodLabel(period: string): string {
  const [year, month] = period.split('-');
  if (!year || !month) return period;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

/** The last N rental months, newest first, as period labels. */
export function recentPeriods(count = 12): string[] {
  const periods: string[] = [];
  const date = new Date();
  date.setUTCDate(1);
  for (let index = 0; index < count; index++) {
    periods.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`);
    date.setUTCMonth(date.getUTCMonth() - 1);
  }
  return periods;
}

export function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

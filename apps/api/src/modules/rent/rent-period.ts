import { parseDateOnly, todayUtc } from '@/modules/leases/lease-dates';

/**
 * A rental period is a calendar month.
 *
 * Version 1 bills whole months: a lease starting on the 20th is charged the
 * full month, not 11/30ths of it. Pro-rata is a real feature with real edge
 * cases (which month length? does the last month prorate too?) and it is
 * deliberately out of scope — but it is isolated to `expectedAmountFor` below,
 * so adding it later touches one function rather than the whole generator.
 */
export interface RentPeriod {
  /** First day of the month, UTC midnight. */
  periodStart: Date;
  /** Last day of the month, UTC midnight. */
  periodEnd: Date;
  /** "2026-09" — human-facing and stable for grouping. */
  periodLabel: string;
}

export function periodFromLabel(label: string): RentPeriod {
  const match = /^(\d{4})-(\d{2})$/.exec(label);
  if (!match) throw new Error(`Invalid period label: ${label}`);
  return periodFor(Number(match[1]), Number(match[2]) - 1);
}

export function currentPeriod(): RentPeriod {
  const today = todayUtc();
  return periodFor(today.getUTCFullYear(), today.getUTCMonth());
}

export function periodFor(year: number, monthIndex: number): RentPeriod {
  const periodStart = new Date(Date.UTC(year, monthIndex, 1));
  // Day 0 of the next month is the last day of this one — no month-length table.
  const periodEnd = new Date(Date.UTC(year, monthIndex + 1, 0));
  const periodLabel = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  return { periodStart, periodEnd, periodLabel };
}

/**
 * The day rent falls due within a period.
 *
 * `dueDay` is capped at 28 by the lease's own constraint, so this can never
 * land outside the month.
 */
export function dueDateFor(period: RentPeriod, dueDay: number): Date {
  return new Date(
    Date.UTC(period.periodStart.getUTCFullYear(), period.periodStart.getUTCMonth(), dueDay),
  );
}

/**
 * Whether a lease should be billed for a period.
 *
 * A lease that starts mid-period is billed in full (see the note above); one
 * that ended before the period began is not billed at all.
 */
export function leaseCoversPeriod(
  lease: { startDate: Date; endDate: Date | null },
  period: RentPeriod,
): boolean {
  if (lease.startDate > period.periodEnd) return false;
  if (lease.endDate && lease.endDate < period.periodStart) return false;
  return true;
}

export function isValidPeriodLabel(label: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(label)) return false;
  const month = Number(label.slice(5, 7));
  return month >= 1 && month <= 12;
}

/** Parses an ISO date string into the period that contains it. */
export function periodContaining(isoDate: string): RentPeriod {
  const date = parseDateOnly(isoDate);
  return periodFor(date.getUTCFullYear(), date.getUTCMonth());
}

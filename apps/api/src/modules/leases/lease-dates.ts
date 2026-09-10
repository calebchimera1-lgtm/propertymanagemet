/**
 * Lease dates are calendar dates, not instants.
 *
 * `startDate` and `endDate` are stored as SQL `DATE`. Parsing "2026-01-01" with
 * `new Date()` in a server running west of UTC yields the previous day, which
 * would shift a lease — and the rent period billed from it — by one day. Always
 * anchoring at UTC midnight keeps a date the same date everywhere.
 */
export function parseDateOnly(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return new Date(Number.NaN);
  return new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
}

/** Today at UTC midnight, for comparing against stored DATE columns. */
export function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** Whole days from today until `date`. Negative once it has passed. */
export function daysUntil(date: Date | null): number | null {
  if (!date) return null;
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.round((date.getTime() - todayUtc().getTime()) / millisecondsPerDay);
}

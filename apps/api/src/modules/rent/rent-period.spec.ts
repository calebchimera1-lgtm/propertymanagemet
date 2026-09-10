import {
  dueDateFor,
  isValidPeriodLabel,
  leaseCoversPeriod,
  periodContaining,
  periodFor,
  periodFromLabel,
} from './rent-period';

/**
 * A rental period is a calendar month, anchored at UTC midnight.
 *
 * Every one of these assertions is about a day boundary, because that is where
 * date bugs live: a period that starts a day early bills the wrong month, and a
 * due date that shifts by a day marks a paying tenant overdue.
 */
describe('rent periods', () => {
  const iso = (date: Date) => date.toISOString();

  it('runs a period from the first to the last day of the month, in UTC', () => {
    const september = periodFromLabel('2026-09');
    expect(iso(september.periodStart)).toBe('2026-09-01T00:00:00.000Z');
    expect(iso(september.periodEnd)).toBe('2026-09-30T00:00:00.000Z');
    expect(september.periodLabel).toBe('2026-09');
  });

  it('gets February right, leap year included', () => {
    expect(iso(periodFromLabel('2026-02').periodEnd)).toBe('2026-02-28T00:00:00.000Z');
    expect(iso(periodFromLabel('2028-02').periodEnd)).toBe('2028-02-29T00:00:00.000Z');
  });

  it('rolls December into the next January without an off-by-one', () => {
    const december = periodFor(2026, 11);
    expect(iso(december.periodStart)).toBe('2026-12-01T00:00:00.000Z');
    expect(iso(december.periodEnd)).toBe('2026-12-31T00:00:00.000Z');
    expect(december.periodLabel).toBe('2026-12');
  });

  it('refuses a label that is not a rental month', () => {
    expect(() => periodFromLabel('2026-9')).toThrow();
    expect(() => periodFromLabel('September')).toThrow();
    expect(isValidPeriodLabel('2026-13')).toBe(false);
    expect(isValidPeriodLabel('2026-00')).toBe(false);
    expect(isValidPeriodLabel('2026-09')).toBe(true);
  });

  it('places the due date inside its own period', () => {
    const period = periodFromLabel('2026-09');
    expect(iso(dueDateFor(period, 5))).toBe('2026-09-05T00:00:00.000Z');
    // dueDay is capped at 28 by the lease constraint, so it can never fall out
    // of a February.
    expect(iso(dueDateFor(periodFromLabel('2026-02'), 28))).toBe('2026-02-28T00:00:00.000Z');
  });

  describe('leaseCoversPeriod', () => {
    const period = periodFromLabel('2026-09');
    const on = (value: string) => new Date(`${value}T00:00:00.000Z`);

    it('bills a lease that starts mid-period in full', () => {
      // Version 1 bills whole months. A lease starting on the 20th is charged
      // the full month, not 11/30ths of it — stated here so a future pro-rata
      // change has to change a test that says what it is changing.
      expect(leaseCoversPeriod({ startDate: on('2026-09-20'), endDate: null }, period)).toBe(true);
    });

    it('bills a lease that starts on the last day of the period', () => {
      expect(leaseCoversPeriod({ startDate: on('2026-09-30'), endDate: null }, period)).toBe(true);
    });

    it('does not bill a lease that starts after the period ends', () => {
      expect(leaseCoversPeriod({ startDate: on('2026-10-01'), endDate: null }, period)).toBe(false);
    });

    it('does not bill a lease that ended before the period began', () => {
      expect(
        leaseCoversPeriod({ startDate: on('2025-01-01'), endDate: on('2026-08-31') }, period),
      ).toBe(false);
    });

    it('bills a lease that ends on the first day of the period', () => {
      expect(
        leaseCoversPeriod({ startDate: on('2025-01-01'), endDate: on('2026-09-01') }, period),
      ).toBe(true);
    });
  });

  it('finds the period containing a date without shifting it', () => {
    // Parsing "2026-01-01" with new Date() in a server west of UTC lands on
    // 2025-12-31 and would bill the wrong month entirely.
    expect(periodContaining('2026-01-01').periodLabel).toBe('2026-01');
    expect(periodContaining('2026-12-31').periodLabel).toBe('2026-12');
  });
});

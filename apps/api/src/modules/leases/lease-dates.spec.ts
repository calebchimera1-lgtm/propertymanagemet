import { addDays, daysUntil, parseDateOnly, todayUtc } from './lease-dates';

describe('lease dates', () => {
  describe('parseDateOnly', () => {
    it('anchors a calendar date at UTC midnight', () => {
      const date = parseDateOnly('2026-01-01');
      expect(date.toISOString()).toBe('2026-01-01T00:00:00.000Z');
      expect(date.getUTCDate()).toBe(1);
      expect(date.getUTCMonth()).toBe(0);
    });

    it('keeps the same calendar day regardless of server timezone', () => {
      // The bug this prevents: `new Date('2026-01-01')` on a server west of UTC
      // can land on 2025-12-31, shifting a lease — and the rent
      // period — by a day.
      const original = process.env.TZ;
      try {
        process.env.TZ = 'America/Los_Angeles';
        expect(parseDateOnly('2026-01-01').toISOString().slice(0, 10)).toBe('2026-01-01');
        process.env.TZ = 'Pacific/Kiritimati';
        expect(parseDateOnly('2026-01-01').toISOString().slice(0, 10)).toBe('2026-01-01');
      } finally {
        process.env.TZ = original;
      }
    });

    it('ignores any time part that comes with the date', () => {
      expect(parseDateOnly('2026-06-15T23:59:59Z').toISOString()).toBe('2026-06-15T00:00:00.000Z');
    });

    it('returns an invalid date for something that is not one', () => {
      expect(Number.isNaN(parseDateOnly('not-a-date').getTime())).toBe(true);
      expect(Number.isNaN(parseDateOnly('').getTime())).toBe(true);
    });
  });

  describe('todayUtc', () => {
    it('is midnight, so it compares cleanly against DATE columns', () => {
      const today = todayUtc();
      expect(today.getUTCHours()).toBe(0);
      expect(today.getUTCMinutes()).toBe(0);
      expect(today.getUTCSeconds()).toBe(0);
      expect(today.getUTCMilliseconds()).toBe(0);
    });
  });

  describe('addDays', () => {
    it('moves forward and backward', () => {
      const base = parseDateOnly('2026-01-31');
      expect(addDays(base, 1).toISOString().slice(0, 10)).toBe('2026-02-01');
      expect(addDays(base, -31).toISOString().slice(0, 10)).toBe('2025-12-31');
    });

    it('crosses a leap day correctly', () => {
      expect(addDays(parseDateOnly('2028-02-28'), 1).toISOString().slice(0, 10)).toBe('2028-02-29');
    });

    it('does not mutate the date it was given', () => {
      const base = parseDateOnly('2026-01-01');
      addDays(base, 10);
      expect(base.toISOString().slice(0, 10)).toBe('2026-01-01');
    });
  });

  describe('daysUntil', () => {
    it('counts whole days ahead', () => {
      expect(daysUntil(addDays(todayUtc(), 30))).toBe(30);
      expect(daysUntil(todayUtc())).toBe(0);
    });

    it('goes negative once the date has passed', () => {
      expect(daysUntil(addDays(todayUtc(), -5))).toBe(-5);
    });

    it('returns null for an open-ended lease', () => {
      // Null is not zero: "no end date" and "ends today" are different things.
      expect(daysUntil(null)).toBeNull();
    });
  });
});

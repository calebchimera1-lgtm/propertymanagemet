import { describe, expect, it } from 'vitest';
import { formatDate, formatMoney, initialsOf } from './utils';

describe('formatMoney', () => {
  it('formats a Decimal string without doing arithmetic on it', () => {
    // Money crosses the wire as a string precisely so it is never a JS number
    // until the moment it is displayed.
    expect(formatMoney('30000.00')).toContain('30,000.00');
    expect(formatMoney('1234567.89')).toContain('1,234,567.89');
  });

  it('keeps two decimal places', () => {
    expect(formatMoney('30000')).toContain('30,000.00');
  });

  it('honours the organization currency', () => {
    expect(formatMoney('1000.00', 'USD')).toContain('1,000.00');
  });

  it('shows a dash rather than NaN for an unusable value', () => {
    expect(formatMoney('not-a-number')).toBe('—');
  });
});

describe('formatDate', () => {
  it('formats an ISO date as day, short month, year', () => {
    // Asserted as a pattern rather than a literal: the exact abbreviation
    // ("Sep" vs "Sept") comes from the runtime's ICU data.
    expect(formatDate('2026-09-09T00:00:00.000Z')).toMatch(/^09 Sept? 2026$/);
  });

  it('shows a dash for a missing date', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
  });
});

describe('initialsOf', () => {
  it('takes the first letter of the first two words', () => {
    expect(initialsOf('Amina Ochieng')).toBe('AO');
    expect(initialsOf('Brian Kimani Otieno')).toBe('BK');
  });

  it('copes with a single name', () => {
    expect(initialsOf('Amina')).toBe('A');
  });
});

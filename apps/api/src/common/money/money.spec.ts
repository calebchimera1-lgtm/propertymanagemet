import { Prisma } from '@pm/database';
import { MONEY_PATTERN, POSITIVE_MONEY_PATTERN, serialiseMoney, toDecimal } from './money';

describe('money serialisation', () => {
  it('always carries two decimal places', () => {
    // Decimal.toString() would give "65000" here, which makes two equal amounts
    // look different and invites the client to parse it as a number.
    expect(serialiseMoney(new Prisma.Decimal('65000.00'))).toBe('65000.00');
    expect(serialiseMoney(new Prisma.Decimal('65000'))).toBe('65000.00');
    expect(serialiseMoney(new Prisma.Decimal('0'))).toBe('0.00');
    expect(serialiseMoney(new Prisma.Decimal('1234567.5'))).toBe('1234567.50');
  });

  it('treats a missing amount as zero rather than null', () => {
    expect(serialiseMoney(null)).toBe('0.00');
    expect(serialiseMoney(undefined)).toBe('0.00');
  });

  it('returns a string, never a number', () => {
    expect(typeof serialiseMoney(new Prisma.Decimal('30000.00'))).toBe('string');
  });

  it('adds exactly, where floating point would not', () => {
    // 0.1 + 0.2 === 0.30000000000000004 in binary floating point. This is the
    // whole reason money is Decimal from the database to the browser.
    const sum = toDecimal('0.10').plus(toDecimal('0.20'));
    expect(serialiseMoney(sum)).toBe('0.30');
    expect(sum.equals(toDecimal('0.30'))).toBe(true);
  });

  it('splits and totals a rent figure without drift', () => {
    const rent = toDecimal('30000.00');
    const paid = toDecimal('20000.00');
    expect(serialiseMoney(rent.minus(paid))).toBe('10000.00');
  });
});

describe('money patterns', () => {
  it('accepts the shapes a form can produce', () => {
    for (const value of ['0', '0.00', '30000', '30000.5', '30000.50', '999999999999.99']) {
      expect(MONEY_PATTERN.test(value)).toBe(true);
    }
  });

  it('rejects anything that is not a plain positive decimal', () => {
    for (const value of ['', '-1', '1.005', '1,000', '1e3', '30000.', 'abc', ' 30000']) {
      expect(MONEY_PATTERN.test(value)).toBe(false);
    }
  });

  it('rejects every spelling of zero where an amount must be above zero', () => {
    // A payment or expense of nothing is not a rounding question, it is a
    // mistake — and it must be caught as a field error, not by a CHECK
    // constraint that surfaces as a server error.
    for (const value of ['0', '0.0', '0.00', '00', '000.00']) {
      expect(POSITIVE_MONEY_PATTERN.test(value)).toBe(false);
    }
  });

  it('still accepts the smallest real amount', () => {
    expect(POSITIVE_MONEY_PATTERN.test('0.01')).toBe(true);
    expect(POSITIVE_MONEY_PATTERN.test('0.10')).toBe(true);
    expect(POSITIVE_MONEY_PATTERN.test('12500.00')).toBe(true);
  });
});

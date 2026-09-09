import { Prisma } from '@pm/database';
import { serialiseMoney, toDecimal } from './money';

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

import { FinanceCalculationService } from './finance-calculation.service';
import { toDecimal } from '@/common/money/money';

/**
 * The money formulas, tested directly.
 *
 * Every report and tile in the product routes through this service, so these
 * assertions are the definition of what the product means by "collected",
 * "outstanding" and "overdue".
 */
describe('FinanceCalculationService', () => {
  const finance = new FinanceCalculationService();
  const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  describe('balanceOf', () => {
    it('subtracts exactly', () => {
      expect(finance.balanceOf(toDecimal('30000.00'), toDecimal('10000.00')).toFixed(2)).toBe(
        '20000.00',
      );
      expect(finance.balanceOf(toDecimal('0.30'), toDecimal('0.10')).toFixed(2)).toBe('0.20');
    });

    it('never goes negative', () => {
      // Overpayment is refused upstream; if one ever reached here, a negative
      // balance rendered as "the landlord owes the tenant" would be worse than
      // clamping.
      expect(finance.balanceOf(toDecimal('100.00'), toDecimal('150.00')).toFixed(2)).toBe('0.00');
    });
  });

  describe('rentStatusOf', () => {
    const today = day('2026-09-10');

    it('is PAID the moment the balance reaches zero, however late', () => {
      expect(
        finance.rentStatusOf(toDecimal('30000'), toDecimal('30000'), day('2026-01-05'), today),
      ).toBe('PAID');
    });

    it('is OVERDUE rather than PARTIALLY_PAID once the due date has passed', () => {
      // What matters operationally is that money is late, not how much of it
      // arrived. A part-paid charge that is late is a chase, not a comfort.
      expect(
        finance.rentStatusOf(toDecimal('30000'), toDecimal('10000'), day('2026-09-05'), today),
      ).toBe('OVERDUE');
    });

    it('is PARTIALLY_PAID while the due date is still ahead', () => {
      expect(
        finance.rentStatusOf(toDecimal('30000'), toDecimal('10000'), day('2026-09-25'), today),
      ).toBe('PARTIALLY_PAID');
    });

    it('is PENDING when nothing has been paid and nothing is late', () => {
      expect(finance.rentStatusOf(toDecimal('30000'), toDecimal('0'), day('2026-09-25'), today)).toBe(
        'PENDING',
      );
    });

    it('treats the due date itself as not yet late', () => {
      expect(finance.rentStatusOf(toDecimal('30000'), toDecimal('0'), today, today)).toBe('PENDING');
    });
  });

  describe('netIncome', () => {
    it('is collected minus spent, on a cash basis', () => {
      // Not expected-minus-spent: the gap between billed and banked is the
      // whole point of an outstanding-rent report.
      expect(finance.netIncome(toDecimal('86000.00'), toDecimal('24000.00')).toFixed(2)).toBe(
        '62000.00',
      );
    });

    it('can be negative in a month of repairs', () => {
      expect(finance.netIncome(toDecimal('10000.00'), toDecimal('45000.00')).toFixed(2)).toBe(
        '-35000.00',
      );
    });
  });

  describe('collectionRate', () => {
    it('rounds to two places', () => {
      expect(finance.collectionRate(toDecimal('86000.00'), toDecimal('36900.00'))).toBe(42.91);
      expect(finance.collectionRate(toDecimal('30000.00'), toDecimal('12000.00'))).toBe(40);
    });

    it('is zero when nothing was expected', () => {
      // A month with no charges has not achieved 100% collection. Reporting 0
      // beside an expected total of 0 is the honest answer.
      expect(finance.collectionRate(toDecimal('0'), toDecimal('0'))).toBe(0);
    });
  });

  describe('occupancyRate', () => {
    it('is occupied over total, to two places', () => {
      expect(finance.occupancyRate(29, 36)).toBe(80.56);
      expect(finance.occupancyRate(0, 10)).toBe(0);
      expect(finance.occupancyRate(10, 10)).toBe(100);
    });

    it('is zero for a property with no units rather than a division by zero', () => {
      expect(finance.occupancyRate(0, 0)).toBe(0);
    });
  });

  describe('sum', () => {
    it('adds a column without floating-point drift', () => {
      const total = finance.sum([toDecimal('0.10'), toDecimal('0.20'), toDecimal('0.30')]);
      expect(total.toFixed(2)).toBe('0.60');
      // 0.1 + 0.2 + 0.3 === 0.6000000000000001 as JavaScript numbers.
      expect(total.equals(toDecimal('0.60'))).toBe(true);
    });

    it('skips nulls rather than treating them as NaN', () => {
      expect(finance.sum([toDecimal('100.00'), null, undefined]).toFixed(2)).toBe('100.00');
      expect(finance.sum([]).toFixed(2)).toBe('0.00');
    });
  });

  describe('rentTotals', () => {
    it('serialises every figure at a fixed scale', () => {
      const totals = finance.rentTotals({
        expected: toDecimal('86000'),
        collected: toDecimal('36900'),
        outstanding: toDecimal('49100'),
        overdue: toDecimal('12000'),
      });

      expect(totals).toEqual({
        expected: '86000.00',
        collected: '36900.00',
        outstanding: '49100.00',
        overdue: '12000.00',
        collectionRate: 42.91,
      });
    });
  });
});

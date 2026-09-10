import { Injectable } from '@nestjs/common';
import { Prisma } from '@pm/database';
import { serialiseMoney, toDecimal } from '@/common/money/money';

export interface RentTotals {
  expected: string;
  collected: string;
  outstanding: string;
  overdue: string;
  collectionRate: number;
}

/**
 * The one place money formulas live (blueprint §49).
 *
 * Every report, dashboard tile and tenant balance in the product calls into
 * here. There is exactly one implementation of "net income", so two screens
 * cannot quietly disagree about it.
 *
 * Everything is Prisma.Decimal arithmetic. Nothing in this file converts an
 * amount to a JavaScript number — 0.1 + 0.2 is 0.30000000000000004 in binary
 * floating point, and a rent roll that drifts by a cent a month is a rent roll
 * nobody trusts.
 */
@Injectable()
export class FinanceCalculationService {
  /** balance = expected − paid. Never negative: overpayment is refused upstream. */
  balanceOf(expectedAmount: Prisma.Decimal, paidAmount: Prisma.Decimal): Prisma.Decimal {
    const balance = expectedAmount.minus(paidAmount);
    return balance.isNegative() ? toDecimal('0') : balance;
  }

  /**
   * A rent record's status, derived from its numbers and the calendar.
   *
   * Never stored independently of the amounts it describes: a PAID record with
   * a balance is the kind of contradiction that turns a report into fiction.
   */
  rentStatusOf(
    expectedAmount: Prisma.Decimal,
    paidAmount: Prisma.Decimal,
    dueDate: Date,
    today: Date,
  ): 'PENDING' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' {
    const balance = this.balanceOf(expectedAmount, paidAmount);

    if (balance.isZero()) return 'PAID';
    // Overdue takes precedence over partially paid: what matters operationally
    // is that money is late, not how much of it arrived.
    if (dueDate < today) return 'OVERDUE';
    if (paidAmount.greaterThan(0)) return 'PARTIALLY_PAID';
    return 'PENDING';
  }

  /**
   * Net income, cash basis: money actually collected minus money actually spent.
   *
   * NOT expected rent minus expenses. The difference between billed and banked
   * is the whole point of an outstanding-rent report, and blurring it here
   * would make every downstream figure optimistic.
   */
  netIncome(collected: Prisma.Decimal, expenses: Prisma.Decimal): Prisma.Decimal {
    return collected.minus(expenses);
  }

  /**
   * Collected ÷ expected, as a percentage rounded to 2dp.
   *
   * Zero when nothing was expected — a month with no charges has not achieved
   * 100% collection, and it has not achieved 0% either; reporting 0 with an
   * expected total of 0 beside it is the honest option.
   */
  collectionRate(expected: Prisma.Decimal, collected: Prisma.Decimal): number {
    if (expected.isZero()) return 0;
    return Number(collected.dividedBy(expected).times(100).toFixed(2));
  }

  /** Occupied ÷ total, as a percentage rounded to 2dp. */
  occupancyRate(occupied: number, total: number): number {
    if (total === 0) return 0;
    return Math.round((occupied / total) * 10000) / 100;
  }

  /** Sums a column of Decimals without ever leaving Decimal arithmetic. */
  sum(amounts: (Prisma.Decimal | null | undefined)[]): Prisma.Decimal {
    return amounts.reduce<Prisma.Decimal>(
      (total, amount) => (amount ? total.plus(amount) : total),
      toDecimal('0'),
    );
  }

  /** Assembles the rent totals every summary screen shows. */
  rentTotals(input: {
    expected: Prisma.Decimal;
    collected: Prisma.Decimal;
    outstanding: Prisma.Decimal;
    overdue: Prisma.Decimal;
  }): RentTotals {
    return {
      expected: serialiseMoney(input.expected),
      collected: serialiseMoney(input.collected),
      outstanding: serialiseMoney(input.outstanding),
      overdue: serialiseMoney(input.overdue),
      collectionRate: this.collectionRate(input.expected, input.collected),
    };
  }
}

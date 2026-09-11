import { Injectable } from '@nestjs/common';
import { Prisma } from '@pm/database';
import { serialiseMoney, toDecimal } from '@/common/money/money';
import { parseDateOnly, todayUtc } from '@/modules/leases/lease-dates';
import { FinanceCalculationService } from '@/modules/rent/finance-calculation.service';
import { periodFromLabel } from '@/modules/rent/rent-period';
import type { ReportContext, ReportResult, ReportStrategy } from '../report.types';

/**
 * The money reports.
 *
 * Every total here comes from a SQL aggregate over the whole filtered set, not
 * from summing the page — a report whose footer only added up the rows you can
 * see would be wrong on page two and nobody would notice.
 */

/** Shared: turn the filters into a date window on a given column. */
function window(context: ReportContext): { gte?: Date; lte?: Date } | undefined {
  const { dateFrom, dateTo, period } = context.filters;

  if (period) {
    const parsed = periodFromLabel(period);
    return { gte: parsed.periodStart, lte: parsed.periodEnd };
  }
  if (!dateFrom && !dateTo) return undefined;
  return {
    ...(dateFrom ? { gte: parseDateOnly(dateFrom) } : {}),
    ...(dateTo ? { lte: parseDateOnly(dateTo) } : {}),
  };
}

function entityFilters(context: ReportContext) {
  const { propertyId, buildingId, unitId, tenantId } = context.filters;
  return {
    ...context.scopeWhere,
    ...(propertyId ? { propertyId } : {}),
    ...(buildingId ? { buildingId } : {}),
    ...(unitId ? { unitId } : {}),
    ...(tenantId ? { tenantId } : {}),
  };
}

@Injectable()
export class RentCollectionReport implements ReportStrategy {
  readonly key = 'rent-collection';
  readonly title = 'Rent collection';
  readonly description = 'Every payment received, with its receipt reference.';
  readonly filters = ['dateFrom', 'dateTo', 'propertyId', 'unitId', 'tenantId', 'paymentMethod'];

  async run(context: ReportContext): Promise<ReportResult> {
    const range = window(context);
    const where: Prisma.PaymentWhereInput = {
      ...entityFilters(context),
      // Voided payments are excluded: the money was reversed, so counting it
      // as collected would overstate every total on the page.
      status: 'COMPLETED',
      ...(range ? { paymentDate: range } : {}),
      ...(context.filters.paymentMethod
        ? { paymentMethod: context.filters.paymentMethod as Prisma.PaymentWhereInput['paymentMethod'] }
        : {}),
    };

    const [rows, total, aggregate] = await Promise.all([
      context.db.payment.findMany({
        where,
        orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }],
        skip: context.skip,
        take: context.take,
        select: {
          paymentDate: true,
          amount: true,
          paymentMethod: true,
          reference: true,
          periodLabel: true,
          tenant: { select: { fullName: true } },
          unit: { select: { unitNumber: true } },
          property: { select: { name: true } },
          receipt: { select: { receiptNumber: true } },
        },
      }),
      context.db.payment.count({ where }),
      context.db.payment.aggregate({ where, _sum: { amount: true } }),
    ]);

    return {
      columns: [
        { key: 'paymentDate', label: 'Date', format: 'date' },
        { key: 'tenant', label: 'Tenant' },
        { key: 'property', label: 'Property' },
        { key: 'unit', label: 'Unit' },
        { key: 'period', label: 'For' },
        { key: 'paymentMethod', label: 'Method' },
        { key: 'reference', label: 'Reference' },
        { key: 'receiptNumber', label: 'Receipt' },
        { key: 'amount', label: 'Amount', format: 'money', numeric: true },
      ],
      rows: rows.map((row) => ({
        paymentDate: row.paymentDate.toISOString().slice(0, 10),
        tenant: row.tenant.fullName,
        property: row.property.name,
        unit: row.unit.unitNumber,
        period: row.periodLabel,
        paymentMethod: row.paymentMethod,
        reference: row.reference,
        receiptNumber: row.receipt?.receiptNumber ?? null,
        amount: serialiseMoney(row.amount),
      })),
      totals: { amount: serialiseMoney(aggregate._sum.amount) },
      meta: { total, page: context.filters.page ?? 1, limit: context.take, count: total },
    };
  }
}

@Injectable()
export class OutstandingRentReport implements ReportStrategy {
  readonly key = 'outstanding-rent';
  readonly title = 'Outstanding rent';
  readonly description = 'Every charge with money still owing, worst first.';
  readonly filters = ['dateFrom', 'dateTo', 'period', 'propertyId', 'unitId', 'tenantId', 'status'];

  constructor(private readonly finance: FinanceCalculationService) {}

  async run(context: ReportContext): Promise<ReportResult> {
    const range = window(context);
    const today = todayUtc();

    const where: Prisma.RentRecordWhereInput = {
      ...entityFilters(context),
      balance: { gt: 0 },
      ...(range ? { periodStart: range } : {}),
      ...(context.filters.status
        ? { status: context.filters.status as Prisma.RentRecordWhereInput['status'] }
        : {}),
    };

    const [rows, total, aggregate] = await Promise.all([
      context.db.rentRecord.findMany({
        where,
        orderBy: [{ balance: 'desc' }, { dueDate: 'asc' }],
        skip: context.skip,
        take: context.take,
        select: {
          periodLabel: true,
          expectedAmount: true,
          paidAmount: true,
          balance: true,
          dueDate: true,
          status: true,
          tenant: { select: { fullName: true, phone: true } },
          unit: { select: { unitNumber: true } },
          property: { select: { name: true } },
        },
      }),
      context.db.rentRecord.count({ where }),
      context.db.rentRecord.aggregate({
        where,
        _sum: { expectedAmount: true, paidAmount: true, balance: true },
      }),
    ]);

    return {
      columns: [
        { key: 'tenant', label: 'Tenant' },
        { key: 'phone', label: 'Phone' },
        { key: 'property', label: 'Property' },
        { key: 'unit', label: 'Unit' },
        { key: 'period', label: 'Period' },
        { key: 'expected', label: 'Charged', format: 'money', numeric: true },
        { key: 'paid', label: 'Paid', format: 'money', numeric: true },
        { key: 'balance', label: 'Owing', format: 'money', numeric: true },
        { key: 'daysOverdue', label: 'Days late', format: 'number', numeric: true },
        { key: 'status', label: 'Status' },
      ],
      rows: rows.map((row) => ({
        tenant: row.tenant.fullName,
        phone: row.tenant.phone,
        property: row.property.name,
        unit: row.unit.unitNumber,
        period: row.periodLabel,
        expected: serialiseMoney(row.expectedAmount),
        paid: serialiseMoney(row.paidAmount),
        balance: serialiseMoney(row.balance),
        daysOverdue:
          row.dueDate < today
            ? Math.round((today.getTime() - row.dueDate.getTime()) / 86_400_000)
            : 0,
        status: row.status,
      })),
      totals: {
        expected: serialiseMoney(aggregate._sum.expectedAmount),
        paid: serialiseMoney(aggregate._sum.paidAmount),
        balance: serialiseMoney(aggregate._sum.balance),
      },
      meta: {
        total,
        page: context.filters.page ?? 1,
        limit: context.take,
        collectionRate: this.finance.collectionRate(
          aggregate._sum.expectedAmount ?? toDecimal('0'),
          aggregate._sum.paidAmount ?? toDecimal('0'),
        ),
      },
    };
  }
}

@Injectable()
export class ExpenseReport implements ReportStrategy {
  readonly key = 'expenses';
  readonly title = 'Expenses';
  readonly description = 'What was spent running the properties, by category.';
  readonly filters = ['dateFrom', 'dateTo', 'propertyId', 'category', 'paymentMethod'];

  async run(context: ReportContext): Promise<ReportResult> {
    const range = window(context);
    const where: Prisma.ExpenseWhereInput = {
      ...entityFilters(context),
      ...(range ? { expenseDate: range } : {}),
      ...(context.filters.category
        ? { category: context.filters.category as Prisma.ExpenseWhereInput['category'] }
        : {}),
      ...(context.filters.paymentMethod
        ? { paymentMethod: context.filters.paymentMethod as Prisma.ExpenseWhereInput['paymentMethod'] }
        : {}),
    };

    const [rows, total, aggregate, byCategory] = await Promise.all([
      context.db.expense.findMany({
        where,
        orderBy: [{ expenseDate: 'desc' }],
        skip: context.skip,
        take: context.take,
        select: {
          expenseDate: true,
          category: true,
          description: true,
          amount: true,
          paymentMethod: true,
          vendor: true,
          reference: true,
          property: { select: { name: true } },
        },
      }),
      context.db.expense.count({ where }),
      context.db.expense.aggregate({ where, _sum: { amount: true } }),
      context.db.expense.groupBy({
        by: ['category'],
        where,
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);

    return {
      columns: [
        { key: 'expenseDate', label: 'Date', format: 'date' },
        { key: 'property', label: 'Property' },
        { key: 'category', label: 'Category' },
        { key: 'description', label: 'Description' },
        { key: 'vendor', label: 'Vendor' },
        { key: 'paymentMethod', label: 'Method' },
        { key: 'reference', label: 'Reference' },
        { key: 'amount', label: 'Amount', format: 'money', numeric: true },
      ],
      rows: rows.map((row) => ({
        expenseDate: row.expenseDate.toISOString().slice(0, 10),
        property: row.property.name,
        category: row.category,
        description: row.description,
        vendor: row.vendor,
        paymentMethod: row.paymentMethod,
        reference: row.reference,
        amount: serialiseMoney(row.amount),
      })),
      totals: { amount: serialiseMoney(aggregate._sum.amount) },
      meta: {
        total,
        page: context.filters.page ?? 1,
        limit: context.take,
        byCategory: byCategory
          .map((row) => ({
            category: row.category,
            total: serialiseMoney(row._sum.amount),
            count: row._count._all,
          }))
          .sort((a, b) => Number(b.total) - Number(a.total)),
      },
    };
  }
}

@Injectable()
export class IncomeReport implements ReportStrategy {
  readonly key = 'income';
  readonly title = 'Income';
  readonly description = 'Charged against collected, month by month.';
  readonly filters = ['dateFrom', 'dateTo', 'propertyId'];

  constructor(private readonly finance: FinanceCalculationService) {}

  async run(context: ReportContext): Promise<ReportResult> {
    const range = window(context);
    const where = {
      ...entityFilters(context),
      ...(range ? { periodStart: range } : {}),
    };

    /*
     * Grouped in PostgreSQL, one row per month.
     *
     * Expected comes from the charges and collected from the payments, so a
     * month where somebody paid late shows the payment in the month it arrived
     * — which is what "collected" means on a cash basis.
     */
    const charges = await context.db.rentRecord.groupBy({
      by: ['periodLabel'],
      where,
      _sum: { expectedAmount: true, paidAmount: true, balance: true },
      _count: { _all: true },
      orderBy: { periodLabel: 'desc' },
    });

    const totals = await context.db.rentRecord.aggregate({
      where,
      _sum: { expectedAmount: true, paidAmount: true, balance: true },
    });

    const page = charges.slice(context.skip, context.skip + context.take);

    return {
      columns: [
        { key: 'period', label: 'Period' },
        { key: 'charges', label: 'Charges', format: 'number', numeric: true },
        { key: 'expected', label: 'Charged', format: 'money', numeric: true },
        { key: 'collected', label: 'Collected', format: 'money', numeric: true },
        { key: 'outstanding', label: 'Outstanding', format: 'money', numeric: true },
        { key: 'collectionRate', label: 'Collection rate', format: 'percent', numeric: true },
      ],
      rows: page.map((row) => ({
        period: row.periodLabel,
        charges: row._count._all,
        expected: serialiseMoney(row._sum.expectedAmount),
        collected: serialiseMoney(row._sum.paidAmount),
        outstanding: serialiseMoney(row._sum.balance),
        collectionRate: this.finance.collectionRate(
          row._sum.expectedAmount ?? toDecimal('0'),
          row._sum.paidAmount ?? toDecimal('0'),
        ),
      })),
      totals: {
        expected: serialiseMoney(totals._sum.expectedAmount),
        collected: serialiseMoney(totals._sum.paidAmount),
        outstanding: serialiseMoney(totals._sum.balance),
        collectionRate: this.finance.collectionRate(
          totals._sum.expectedAmount ?? toDecimal('0'),
          totals._sum.paidAmount ?? toDecimal('0'),
        ),
      },
      meta: { total: charges.length, page: context.filters.page ?? 1, limit: context.take },
    };
  }
}

@Injectable()
export class ProfitLossReport implements ReportStrategy {
  readonly key = 'profit-loss';
  readonly title = 'Profit and loss';
  readonly description = 'Collected income against expenses, per property.';
  readonly filters = ['dateFrom', 'dateTo', 'propertyId'];

  constructor(private readonly finance: FinanceCalculationService) {}

  async run(context: ReportContext): Promise<ReportResult> {
    const range = window(context);
    const from = range?.gte ?? new Date(Date.UTC(1970, 0, 1));
    const to = range?.lte ?? new Date(Date.UTC(2999, 11, 31));

    const propertyWhere = {
      ...(context.propertyIds === null ? {} : { id: { in: context.propertyIds } }),
      ...(context.filters.propertyId ? { id: context.filters.propertyId } : {}),
      status: { not: 'ARCHIVED' as const },
    };

    const properties = await context.db.property.findMany({
      where: propertyWhere,
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });

    if (properties.length === 0) {
      return {
        columns: this.columns(),
        rows: [],
        totals: { collected: '0.00', expenses: '0.00', netIncome: '0.00' },
        meta: { total: 0, page: context.filters.page ?? 1, limit: context.take },
      };
    }

    const ids = properties.map((property) => property.id);

    /*
     * Two grouped queries, not one per property.
     *
     * The N+1 version is the obvious one to write and the one that turns a
     * 200-property report into 400 round trips.
     */
    const [collected, spent] = await Promise.all([
      context.db.payment.groupBy({
        by: ['propertyId'],
        where: {
          propertyId: { in: ids },
          status: 'COMPLETED',
          paymentDate: { gte: from, lte: to },
        },
        _sum: { amount: true },
      }),
      context.db.expense.groupBy({
        by: ['propertyId'],
        where: { propertyId: { in: ids }, expenseDate: { gte: from, lte: to } },
        _sum: { amount: true },
      }),
    ]);

    const collectedBy = new Map(collected.map((row) => [row.propertyId, row._sum.amount]));
    const spentBy = new Map(spent.map((row) => [row.propertyId, row._sum.amount]));

    let totalCollected = toDecimal('0');
    let totalSpent = toDecimal('0');

    const rows = properties.map((property) => {
      const income = collectedBy.get(property.id) ?? toDecimal('0');
      const outgoing = spentBy.get(property.id) ?? toDecimal('0');
      totalCollected = totalCollected.plus(income);
      totalSpent = totalSpent.plus(outgoing);

      return {
        property: property.name,
        collected: serialiseMoney(income),
        expenses: serialiseMoney(outgoing),
        netIncome: serialiseMoney(this.finance.netIncome(income, outgoing)),
        margin: income.isZero()
          ? 0
          : Number(this.finance.netIncome(income, outgoing).dividedBy(income).times(100).toFixed(2)),
      };
    });

    return {
      columns: this.columns(),
      rows: rows.slice(context.skip, context.skip + context.take),
      totals: {
        collected: serialiseMoney(totalCollected),
        expenses: serialiseMoney(totalSpent),
        netIncome: serialiseMoney(this.finance.netIncome(totalCollected, totalSpent)),
      },
      meta: { total: rows.length, page: context.filters.page ?? 1, limit: context.take },
    };
  }

  private columns() {
    return [
      { key: 'property', label: 'Property' },
      { key: 'collected', label: 'Collected', format: 'money' as const, numeric: true },
      { key: 'expenses', label: 'Expenses', format: 'money' as const, numeric: true },
      { key: 'netIncome', label: 'Net', format: 'money' as const, numeric: true },
      { key: 'margin', label: 'Margin', format: 'percent' as const, numeric: true },
    ];
  }
}

import { Injectable } from '@nestjs/common';
import { Prisma } from '@pm/database';
import { NotFoundError } from '@/common/errors/domain.errors';
import { serialiseMoney, toDecimal } from '@/common/money/money';
import { todayUtc } from '@/modules/leases/lease-dates';
import { FinanceCalculationService } from '@/modules/rent/finance-calculation.service';
import { currentPeriod, periodFromLabel } from '@/modules/rent/rent-period';
import { InjectScopedPrisma } from '@/prisma/prisma.module';
import type { ScopedPrismaClient } from '@/prisma/tenant-scope.extension';
import { PropertyScopeService } from '@/tenancy/property-scope.service';
import { TenantContextService } from '@/tenancy/tenant-context.service';
import type { DashboardChartsQueryDto, DashboardSummaryQueryDto } from './dto/dashboard.dto';

/**
 * The dashboard.
 *
 * Three rules hold everywhere in this file:
 *
 *   1. **Nothing is computed in the browser and nothing is hardcoded.** Every
 *      figure is a SQL aggregate over Decimal columns, serialised as a
 *      fixed-scale string.
 *   2. **Aggregation happens in PostgreSQL**, not in Node loops. Twelve months
 *      of series come from one `date_trunc GROUP BY` per series, not from
 *      twelve queries or a per-property N+1.
 *   3. **A scoped user sees their own dashboard.** The same organization filter
 *      and property scope as every other endpoint — and a staff member with no
 *      assignments sees zeros with an explanation, never the whole
 *      organization.
 */
@Injectable()
export class DashboardService {
  constructor(
    @InjectScopedPrisma() private readonly db: ScopedPrismaClient,
    private readonly scope: PropertyScopeService,
    private readonly tenant: TenantContextService,
    private readonly finance: FinanceCalculationService,
  ) {}

  /**
   * The property ids every raw query is filtered by.
   *
   * `null` never reaches SQL: an unrestricted caller is filtered by
   * organization alone, and a restricted one by an explicit id list. The empty
   * list is a real answer meaning "sees nothing", and the callers below return
   * zeros rather than dropping the filter.
   */
  private async scopeFilter(propertyId?: string): Promise<{
    organizationId: string;
    propertyIds: string[] | null;
    empty: boolean;
  }> {
    const auth = this.tenant.getOrThrow();

    if (propertyId) {
      this.scope.assertProperty(propertyId);
      const exists = await this.db.property.count({ where: { id: propertyId } });
      if (exists === 0) throw new NotFoundError('Property');
      return { organizationId: auth.organizationId, propertyIds: [propertyId], empty: false };
    }

    const scoped = this.scope.propertyIds;
    return {
      organizationId: auth.organizationId,
      propertyIds: scoped,
      empty: scoped !== null && scoped.length === 0,
    };
  }

  /** `AND "propertyId" IN (…)` when restricted, nothing when not. */
  private propertyClause(propertyIds: string[] | null, column = '"propertyId"'): Prisma.Sql {
    if (propertyIds === null) return Prisma.empty;
    return Prisma.sql` AND ${Prisma.raw(column)} IN (${Prisma.join(propertyIds)})`;
  }

  async summary(query: DashboardSummaryQueryDto) {
    const { organizationId, propertyIds, empty } = await this.scopeFilter(query.propertyId);
    const period = query.period ? periodFromLabel(query.period) : currentPeriod();
    const previous = periodFromLabel(
      `${period.periodStart.getUTCFullYear()}-${String(period.periodStart.getUTCMonth() + 1).padStart(2, '0')}`,
    );
    const previousStart = new Date(
      Date.UTC(previous.periodStart.getUTCFullYear(), previous.periodStart.getUTCMonth() - 1, 1),
    );

    if (empty) return this.emptySummary(period.periodLabel);

    const propertyWhere = propertyIds === null ? {} : { id: { in: propertyIds } };
    const scopeWhere = propertyIds === null ? {} : { propertyId: { in: propertyIds } };

    const [
      propertyCount,
      buildingCount,
      unitCounts,
      rentTotals,
      overdueTotal,
      collected,
      expenses,
      previousOccupancy,
    ] = await Promise.all([
      this.db.property.count({ where: { ...propertyWhere, status: { not: 'ARCHIVED' } } }),
      this.db.building.count({ where: { ...scopeWhere, status: { not: 'ARCHIVED' } } }),
      this.db.unit.groupBy({ by: ['status'], where: scopeWhere, _count: { _all: true } }),
      this.db.rentRecord.aggregate({
        where: { ...scopeWhere, periodStart: period.periodStart },
        _sum: { expectedAmount: true, paidAmount: true, balance: true },
        _count: { _all: true },
      }),
      this.db.rentRecord.aggregate({
        // Outstanding across every period, not just this one: a tenant who
        // cleared September but still owes for July is still in arrears.
        where: { ...scopeWhere, balance: { gt: 0 }, dueDate: { lt: todayUtc() } },
        _sum: { balance: true },
      }),
      this.db.payment.aggregate({
        where: {
          ...scopeWhere,
          status: 'COMPLETED',
          paymentDate: { gte: period.periodStart, lte: period.periodEnd },
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.db.expense.aggregate({
        where: {
          ...scopeWhere,
          expenseDate: { gte: period.periodStart, lte: period.periodEnd },
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.occupancyAt(organizationId, propertyIds, previousStart),
    ]);

    const units = { total: 0, occupied: 0, vacant: 0, maintenance: 0, reserved: 0, unavailable: 0 };
    for (const row of unitCounts) {
      units.total += row._count._all;
      switch (row.status) {
        case 'OCCUPIED':
          units.occupied += row._count._all;
          break;
        case 'VACANT':
          units.vacant += row._count._all;
          break;
        case 'MAINTENANCE':
          units.maintenance += row._count._all;
          break;
        case 'RESERVED':
          units.reserved += row._count._all;
          break;
        default:
          units.unavailable += row._count._all;
      }
    }

    const expected = rentTotals._sum.expectedAmount ?? toDecimal('0');
    const collectedAmount = collected._sum.amount ?? toDecimal('0');
    const outstanding = rentTotals._sum.balance ?? toDecimal('0');
    const expenseAmount = expenses._sum.amount ?? toDecimal('0');
    const occupancyRate = this.finance.occupancyRate(units.occupied, units.total);

    return {
      period: period.periodLabel,
      portfolio: {
        properties: propertyCount,
        buildings: buildingCount,
        units,
        occupancyRate,
        /**
         * Percentage points, not a percentage of a percentage. Null when there
         * is no previous month to compare against — an arrow pointing at
         * nothing is worse than no arrow.
         */
        occupancyDelta:
          previousOccupancy === null
            ? null
            : Math.round((occupancyRate - previousOccupancy) * 100) / 100,
      },
      money: {
        expected: serialiseMoney(expected),
        collected: serialiseMoney(collectedAmount),
        outstanding: serialiseMoney(outstanding),
        overdue: serialiseMoney(overdueTotal._sum.balance ?? toDecimal('0')),
        expenses: serialiseMoney(expenseAmount),
        // Cash basis: money actually collected minus money actually spent.
        netIncome: serialiseMoney(this.finance.netIncome(collectedAmount, expenseAmount)),
        collectionRate: this.finance.collectionRate(expected, collectedAmount),
        chargeCount: rentTotals._count._all,
        paymentCount: collected._count._all,
        expenseCount: expenses._count._all,
      },
      scoped: this.scope.isRestricted,
    };
  }

  /**
   * Occupancy as it stood at a past date, reconstructed from leases.
   *
   * `Unit.status` only knows about now, so a month-over-month delta cannot come
   * from it. A unit counts as occupied for a month if a lease covering that
   * month existed — which is what the occupancy trend chart shows too.
   */
  private async occupancyAt(
    organizationId: string,
    propertyIds: string[] | null,
    monthStart: Date,
  ): Promise<number | null> {
    const monthEnd = new Date(
      Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0),
    );

    const rows = await this.db.$queryRaw<{ occupied: bigint; total: bigint }[]>`
      SELECT
        COUNT(DISTINCT l."unitId") AS occupied,
        (SELECT COUNT(*) FROM "Unit" u
          WHERE u."organizationId" = ${organizationId}
            AND u."createdAt" <= ${monthEnd}
            ${this.propertyClause(propertyIds, 'u."propertyId"')}) AS total
      FROM "Lease" l
      WHERE l."organizationId" = ${organizationId}
        AND l."startDate" <= ${monthEnd}
        AND (l."endDate" IS NULL OR l."endDate" >= ${monthStart})
        AND (l."terminatedAt" IS NULL OR l."terminatedAt" >= ${monthStart})
        ${this.propertyClause(propertyIds, 'l."propertyId"')}
    `;

    const row = rows[0];
    if (!row || Number(row.total) === 0) return null;
    return this.finance.occupancyRate(Number(row.occupied), Number(row.total));
  }

  private emptySummary(period: string) {
    return {
      period,
      portfolio: {
        properties: 0,
        buildings: 0,
        units: { total: 0, occupied: 0, vacant: 0, maintenance: 0, reserved: 0, unavailable: 0 },
        occupancyRate: 0,
        occupancyDelta: null,
      },
      money: {
        expected: '0.00',
        collected: '0.00',
        outstanding: '0.00',
        overdue: '0.00',
        expenses: '0.00',
        netIncome: '0.00',
        collectionRate: 0,
        chargeCount: 0,
        paymentCount: 0,
        expenseCount: 0,
      },
      scoped: true,
    };
  }

  async charts(query: DashboardChartsQueryDto) {
    const { organizationId, propertyIds, empty } = await this.scopeFilter(query.propertyId);
    const months = query.months ?? 12;
    const buckets = this.monthBuckets(months);

    if (empty) {
      return {
        months: buckets.map((bucket) => ({
          period: bucket.label,
          expected: '0.00',
          collected: '0.00',
          expenses: '0.00',
          netIncome: '0.00',
          occupancyRate: 0,
        })),
        expensesByCategory: [],
        propertyPerformance: [],
        scoped: true,
      };
    }

    const from = buckets[0]!.start;
    const to = buckets[buckets.length - 1]!.end;

    const [expectedRows, collectedRows, expenseRows, categoryRows, propertyRows] =
      await Promise.all([
        this.db.$queryRaw<{ month: Date; total: Prisma.Decimal }[]>`
          SELECT date_trunc('month', "periodStart") AS month, SUM("expectedAmount") AS total
          FROM "RentRecord"
          WHERE "organizationId" = ${organizationId}
            AND "periodStart" BETWEEN ${from} AND ${to}
            ${this.propertyClause(propertyIds)}
          GROUP BY 1
        `,
        this.db.$queryRaw<{ month: Date; total: Prisma.Decimal }[]>`
          SELECT date_trunc('month', "paymentDate") AS month, SUM("amount") AS total
          FROM "Payment"
          WHERE "organizationId" = ${organizationId}
            AND "status" = 'COMPLETED'
            AND "paymentDate" BETWEEN ${from} AND ${to}
            ${this.propertyClause(propertyIds)}
          GROUP BY 1
        `,
        this.db.$queryRaw<{ month: Date; total: Prisma.Decimal }[]>`
          SELECT date_trunc('month', "expenseDate") AS month, SUM("amount") AS total
          FROM "Expense"
          WHERE "organizationId" = ${organizationId}
            AND "expenseDate" BETWEEN ${from} AND ${to}
            ${this.propertyClause(propertyIds)}
          GROUP BY 1
        `,
        this.db.expense.groupBy({
          by: ['category'],
          where: {
            ...(propertyIds === null ? {} : { propertyId: { in: propertyIds } }),
            expenseDate: { gte: from, lte: to },
          },
          _sum: { amount: true },
          _count: { _all: true },
        }),
        this.db.$queryRaw<
          { id: string; name: string; collected: Prisma.Decimal | null; spent: Prisma.Decimal | null }[]
        >`
          SELECT
            p."id",
            p."name",
            (SELECT SUM(pay."amount") FROM "Payment" pay
              WHERE pay."propertyId" = p."id" AND pay."status" = 'COMPLETED'
                AND pay."paymentDate" BETWEEN ${from} AND ${to}) AS collected,
            (SELECT SUM(e."amount") FROM "Expense" e
              WHERE e."propertyId" = p."id"
                AND e."expenseDate" BETWEEN ${from} AND ${to}) AS spent
          FROM "Property" p
          WHERE p."organizationId" = ${organizationId}
            AND p."status" <> 'ARCHIVED'
            ${this.propertyClause(propertyIds, 'p."id"')}
          ORDER BY collected DESC NULLS LAST
          LIMIT 10
        `,
      ]);

    const occupancy = await this.occupancySeries(organizationId, propertyIds, buckets);

    const expectedByMonth = this.indexByMonth(expectedRows);
    const collectedByMonth = this.indexByMonth(collectedRows);
    const expensesByMonth = this.indexByMonth(expenseRows);

    return {
      /*
       * One row per month, always — including months with nothing in them.
       * A chart that silently drops empty months draws a line between March
       * and June as though May never happened.
       */
      months: buckets.map((bucket) => {
        const expected = expectedByMonth.get(bucket.key) ?? toDecimal('0');
        const collected = collectedByMonth.get(bucket.key) ?? toDecimal('0');
        const spent = expensesByMonth.get(bucket.key) ?? toDecimal('0');
        return {
          period: bucket.label,
          expected: serialiseMoney(expected),
          collected: serialiseMoney(collected),
          expenses: serialiseMoney(spent),
          netIncome: serialiseMoney(this.finance.netIncome(collected, spent)),
          collectionRate: this.finance.collectionRate(expected, collected),
          occupancyRate: occupancy.get(bucket.key) ?? 0,
        };
      }),
      expensesByCategory: categoryRows
        .map((row) => ({
          category: row.category,
          total: serialiseMoney(row._sum.amount),
          count: row._count._all,
        }))
        .sort((a, b) => Number(b.total) - Number(a.total)),
      propertyPerformance: propertyRows.map((row) => ({
        id: row.id,
        name: row.name,
        collected: serialiseMoney(row.collected),
        expenses: serialiseMoney(row.spent),
        netIncome: serialiseMoney(
          this.finance.netIncome(row.collected ?? toDecimal('0'), row.spent ?? toDecimal('0')),
        ),
      })),
      scoped: this.scope.isRestricted,
    };
  }

  /** Occupancy for each bucket, from leases, in one query rather than N. */
  private async occupancySeries(
    organizationId: string,
    propertyIds: string[] | null,
    buckets: { key: string; start: Date; end: Date }[],
  ): Promise<Map<string, number>> {
    const from = buckets[0]!.start;
    const to = buckets[buckets.length - 1]!.end;

    const rows = await this.db.$queryRaw<{ month: Date; occupied: bigint }[]>`
      SELECT m."month", COUNT(DISTINCT l."unitId") AS occupied
      FROM generate_series(${from}::timestamp, ${to}::timestamp, '1 month') AS m("month")
      LEFT JOIN "Lease" l
        ON l."organizationId" = ${organizationId}
       AND l."startDate" <= (m."month" + interval '1 month' - interval '1 day')
       AND (l."endDate" IS NULL OR l."endDate" >= m."month")
       AND (l."terminatedAt" IS NULL OR l."terminatedAt" >= m."month")
       ${this.propertyClause(propertyIds, 'l."propertyId"')}
      GROUP BY m."month"
    `;

    const totalUnits = await this.db.unit.count({
      where: propertyIds === null ? {} : { propertyId: { in: propertyIds } },
    });

    const series = new Map<string, number>();
    for (const row of rows) {
      series.set(
        this.monthKey(row.month),
        this.finance.occupancyRate(Number(row.occupied), totalUnits),
      );
    }
    return series;
  }

  private monthKey(date: Date): string {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  private indexByMonth(
    rows: { month: Date; total: Prisma.Decimal | null }[],
  ): Map<string, Prisma.Decimal> {
    const map = new Map<string, Prisma.Decimal>();
    for (const row of rows) {
      map.set(this.monthKey(row.month), row.total ?? toDecimal('0'));
    }
    return map;
  }

  /** The last N months, oldest first, at UTC month boundaries. */
  private monthBuckets(months: number): { key: string; label: string; start: Date; end: Date }[] {
    const today = todayUtc();
    const buckets: { key: string; label: string; start: Date; end: Date }[] = [];

    for (let offset = months - 1; offset >= 0; offset--) {
      const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - offset, 1));
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
      const key = this.monthKey(start);
      buckets.push({ key, label: key, start, end });
    }
    return buckets;
  }

  /** The four worklists: what needs doing today. */
  async worklists() {
    const { propertyIds, empty } = await this.scopeFilter();
    if (empty) {
      return {
        overdueRent: [],
        expiringLeases: [],
        openMaintenance: [],
        recentPayments: [],
        scoped: true,
      };
    }

    const scopeWhere = propertyIds === null ? {} : { propertyId: { in: propertyIds } };
    const today = todayUtc();
    const in60Days = new Date(today.getTime() + 60 * 86_400_000);

    const [overdueRent, expiringLeases, openMaintenance, recentPayments] = await Promise.all([
      this.db.rentRecord.findMany({
        where: { ...scopeWhere, balance: { gt: 0 }, dueDate: { lt: today } },
        orderBy: { balance: 'desc' },
        take: 10,
        select: {
          id: true,
          periodLabel: true,
          balance: true,
          dueDate: true,
          tenant: { select: { id: true, fullName: true } },
          unit: { select: { id: true, unitNumber: true } },
          property: { select: { id: true, name: true } },
        },
      }),
      this.db.lease.findMany({
        where: {
          ...scopeWhere,
          status: { in: ['ACTIVE', 'EXPIRING_SOON'] },
          endDate: { gte: today, lte: in60Days },
        },
        orderBy: { endDate: 'asc' },
        take: 10,
        select: {
          id: true,
          endDate: true,
          monthlyRent: true,
          tenant: { select: { id: true, fullName: true } },
          unit: { select: { id: true, unitNumber: true } },
          property: { select: { id: true, name: true } },
        },
      }),
      this.db.maintenanceRequest.findMany({
        where: { ...scopeWhere, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
        // URGENT first: the list is a queue, not a log.
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
        take: 10,
        select: {
          id: true,
          title: true,
          priority: true,
          status: true,
          createdAt: true,
          property: { select: { id: true, name: true } },
          unit: { select: { id: true, unitNumber: true } },
        },
      }),
      this.db.payment.findMany({
        where: { ...scopeWhere, status: 'COMPLETED' },
        orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }],
        take: 10,
        select: {
          id: true,
          amount: true,
          paymentDate: true,
          paymentMethod: true,
          periodLabel: true,
          tenant: { select: { id: true, fullName: true } },
          unit: { select: { id: true, unitNumber: true } },
          receipt: { select: { id: true, receiptNumber: true } },
        },
      }),
    ]);

    return {
      overdueRent: overdueRent.map((record) => ({
        ...record,
        balance: serialiseMoney(record.balance),
        daysOverdue: Math.round((today.getTime() - record.dueDate.getTime()) / 86_400_000),
      })),
      expiringLeases: expiringLeases.map((lease) => ({
        ...lease,
        monthlyRent: serialiseMoney(lease.monthlyRent),
        daysRemaining: lease.endDate
          ? Math.round((lease.endDate.getTime() - today.getTime()) / 86_400_000)
          : null,
      })),
      openMaintenance,
      recentPayments: recentPayments.map((payment) => ({
        ...payment,
        amount: serialiseMoney(payment.amount),
      })),
      scoped: this.scope.isRestricted,
    };
  }
}

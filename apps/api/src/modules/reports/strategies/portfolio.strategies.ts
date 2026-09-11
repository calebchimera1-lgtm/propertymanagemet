import { Injectable } from '@nestjs/common';
import { Prisma } from '@pm/database';
import { serialiseMoney, toDecimal } from '@/common/money/money';
import { parseDateOnly, todayUtc } from '@/modules/leases/lease-dates';
import { FinanceCalculationService } from '@/modules/rent/finance-calculation.service';
import type { ReportContext, ReportResult, ReportStrategy } from '../report.types';

/**
 * The reports about people, places and work rather than money.
 *
 * They still route every derived figure through FinanceCalculationService —
 * an occupancy rate computed two different ways is two different products.
 */

function dateWindow(context: ReportContext): { gte?: Date; lte?: Date } | undefined {
  const { dateFrom, dateTo } = context.filters;
  if (!dateFrom && !dateTo) return undefined;
  return {
    ...(dateFrom ? { gte: parseDateOnly(dateFrom) } : {}),
    ...(dateTo ? { lte: parseDateOnly(dateTo) } : {}),
  };
}

@Injectable()
export class TenantReport implements ReportStrategy {
  readonly key = 'tenants';
  readonly title = 'Tenants';
  readonly description = 'Who lives where, on what terms, and what they owe.';
  readonly filters = ['propertyId', 'unitId', 'status'];

  async run(context: ReportContext): Promise<ReportResult> {
    /*
     * A tenant belongs to the organization, not a property, so scope reaches
     * them through their leases — the same rule the tenant list uses. Without
     * the lease hop, a caretaker's tenant report would cover the whole
     * organization.
     */
    const scoped = context.propertyIds !== null || context.filters.propertyId;
    const leaseFilter: Prisma.LeaseWhereInput = {
      ...context.scopeWhere,
      ...(context.filters.propertyId ? { propertyId: context.filters.propertyId } : {}),
      ...(context.filters.unitId ? { unitId: context.filters.unitId } : {}),
    };

    const where: Prisma.TenantWhereInput = {
      ...(scoped ? { leases: { some: leaseFilter } } : {}),
      ...(context.filters.status === 'ACTIVE'
        ? { isActive: true }
        : context.filters.status === 'INACTIVE'
          ? { isActive: false }
          : {}),
    };

    const [tenants, total] = await Promise.all([
      context.db.tenant.findMany({
        where,
        orderBy: { fullName: 'asc' },
        skip: context.skip,
        take: context.take,
        select: {
          id: true,
          fullName: true,
          phone: true,
          email: true,
          isActive: true,
          leases: {
            where: { status: { in: ['ACTIVE', 'EXPIRING_SOON'] } },
            orderBy: { startDate: 'desc' },
            take: 1,
            select: {
              startDate: true,
              endDate: true,
              monthlyRent: true,
              status: true,
              unit: { select: { unitNumber: true } },
              property: { select: { name: true } },
            },
          },
        },
      }),
      context.db.tenant.count({ where }),
    ]);

    // Balances for the page's tenants in one grouped query, not one each.
    const ids = tenants.map((tenant) => tenant.id);
    const balances = ids.length
      ? await context.db.rentRecord.groupBy({
          by: ['tenantId'],
          where: { tenantId: { in: ids }, ...context.scopeWhere },
          _sum: { balance: true },
        })
      : [];
    const balanceBy = new Map(balances.map((row) => [row.tenantId, row._sum.balance]));

    const portfolioBalance = await context.db.rentRecord.aggregate({
      where: {
        ...context.scopeWhere,
        ...(scoped ? { tenant: { leases: { some: leaseFilter } } } : {}),
      },
      _sum: { balance: true },
    });

    return {
      columns: [
        { key: 'tenant', label: 'Tenant' },
        { key: 'phone', label: 'Phone' },
        { key: 'email', label: 'Email' },
        { key: 'property', label: 'Property' },
        { key: 'unit', label: 'Unit' },
        { key: 'leaseStart', label: 'Lease start', format: 'date' },
        { key: 'leaseEnd', label: 'Lease end', format: 'date' },
        { key: 'monthlyRent', label: 'Rent', format: 'money', numeric: true },
        { key: 'balance', label: 'Owing', format: 'money', numeric: true },
        { key: 'status', label: 'Status' },
      ],
      rows: tenants.map((tenant) => {
        const lease = tenant.leases[0];
        return {
          tenant: tenant.fullName,
          phone: tenant.phone,
          email: tenant.email,
          property: lease?.property.name ?? null,
          unit: lease?.unit.unitNumber ?? null,
          leaseStart: lease?.startDate.toISOString().slice(0, 10) ?? null,
          leaseEnd: lease?.endDate?.toISOString().slice(0, 10) ?? null,
          monthlyRent: lease ? serialiseMoney(lease.monthlyRent) : null,
          balance: serialiseMoney(balanceBy.get(tenant.id) ?? toDecimal('0')),
          // Housed and active are different facts, and the column says which.
          status: lease ? lease.status : tenant.isActive ? 'NOT HOUSED' : 'INACTIVE',
        };
      }),
      totals: { balance: serialiseMoney(portfolioBalance._sum.balance) },
      meta: { total, page: context.filters.page ?? 1, limit: context.take },
    };
  }
}

@Injectable()
export class OccupancyReport implements ReportStrategy {
  readonly key = 'occupancy';
  readonly title = 'Occupancy';
  readonly description = 'How full each property is, and what is standing empty.';
  readonly filters = ['propertyId'];

  constructor(private readonly finance: FinanceCalculationService) {}

  async run(context: ReportContext): Promise<ReportResult> {
    const propertyWhere: Prisma.PropertyWhereInput = {
      ...(context.propertyIds === null ? {} : { id: { in: context.propertyIds } }),
      ...(context.filters.propertyId ? { id: context.filters.propertyId } : {}),
      status: { not: 'ARCHIVED' },
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
        totals: { total: 0, occupied: 0, vacant: 0, occupancyRate: 0 },
        meta: { total: 0, page: context.filters.page ?? 1, limit: context.take },
      };
    }

    const ids = properties.map((property) => property.id);
    const grouped = await context.db.unit.groupBy({
      by: ['propertyId', 'status'],
      where: { propertyId: { in: ids } },
      _count: { _all: true },
    });

    const byProperty = new Map<string, Record<string, number>>();
    for (const row of grouped) {
      const counts = byProperty.get(row.propertyId) ?? {};
      counts[row.status] = row._count._all;
      byProperty.set(row.propertyId, counts);
    }

    let portfolioTotal = 0;
    let portfolioOccupied = 0;

    const rows = properties.map((property) => {
      const counts = byProperty.get(property.id) ?? {};
      const occupied = counts.OCCUPIED ?? 0;
      const vacant = counts.VACANT ?? 0;
      const maintenance = counts.MAINTENANCE ?? 0;
      const reserved = counts.RESERVED ?? 0;
      const unavailable = counts.UNAVAILABLE ?? 0;
      const total = occupied + vacant + maintenance + reserved + unavailable;

      portfolioTotal += total;
      portfolioOccupied += occupied;

      return {
        property: property.name,
        total,
        occupied,
        vacant,
        reserved,
        maintenance,
        unavailable,
        occupancyRate: this.finance.occupancyRate(occupied, total),
      };
    });

    return {
      columns: this.columns(),
      rows: rows.slice(context.skip, context.skip + context.take),
      totals: {
        total: portfolioTotal,
        occupied: portfolioOccupied,
        vacant: portfolioTotal - portfolioOccupied,
        // The portfolio rate, not the average of the per-property rates —
        // averaging a 1-unit property with a 200-unit one would be a lie.
        occupancyRate: this.finance.occupancyRate(portfolioOccupied, portfolioTotal),
      },
      meta: { total: rows.length, page: context.filters.page ?? 1, limit: context.take },
    };
  }

  private columns() {
    return [
      { key: 'property', label: 'Property' },
      { key: 'total', label: 'Units', format: 'number' as const, numeric: true },
      { key: 'occupied', label: 'Occupied', format: 'number' as const, numeric: true },
      { key: 'vacant', label: 'Vacant', format: 'number' as const, numeric: true },
      { key: 'reserved', label: 'Reserved', format: 'number' as const, numeric: true },
      { key: 'maintenance', label: 'Maintenance', format: 'number' as const, numeric: true },
      { key: 'unavailable', label: 'Unavailable', format: 'number' as const, numeric: true },
      { key: 'occupancyRate', label: 'Occupancy', format: 'percent' as const, numeric: true },
    ];
  }
}

@Injectable()
export class MaintenanceReport implements ReportStrategy {
  readonly key = 'maintenance';
  readonly title = 'Maintenance';
  readonly description = 'Every job raised, what it cost, and where it got to.';
  readonly filters = ['dateFrom', 'dateTo', 'propertyId', 'status'];

  async run(context: ReportContext): Promise<ReportResult> {
    const range = dateWindow(context);
    const where: Prisma.MaintenanceRequestWhereInput = {
      ...context.scopeWhere,
      ...(context.filters.propertyId ? { propertyId: context.filters.propertyId } : {}),
      ...(context.filters.unitId ? { unitId: context.filters.unitId } : {}),
      ...(range ? { createdAt: range } : {}),
      ...(context.filters.status
        ? { status: context.filters.status as Prisma.MaintenanceRequestWhereInput['status'] }
        : {}),
    };

    const [rows, total, aggregate, byStatus] = await Promise.all([
      context.db.maintenanceRequest.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: context.skip,
        take: context.take,
        select: {
          createdAt: true,
          completedAt: true,
          title: true,
          priority: true,
          status: true,
          estimatedCost: true,
          actualCost: true,
          property: { select: { name: true } },
          unit: { select: { unitNumber: true } },
          assignedTo: { select: { fullName: true } },
        },
      }),
      context.db.maintenanceRequest.count({ where }),
      context.db.maintenanceRequest.aggregate({
        where,
        _sum: { estimatedCost: true, actualCost: true },
      }),
      context.db.maintenanceRequest.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
    ]);

    return {
      columns: [
        { key: 'createdAt', label: 'Raised', format: 'date' },
        { key: 'property', label: 'Property' },
        { key: 'unit', label: 'Unit' },
        { key: 'title', label: 'Job' },
        { key: 'priority', label: 'Priority' },
        { key: 'status', label: 'Status' },
        { key: 'assignedTo', label: 'Assigned to' },
        { key: 'estimatedCost', label: 'Estimated', format: 'money', numeric: true },
        { key: 'actualCost', label: 'Actual', format: 'money', numeric: true },
        { key: 'daysOpen', label: 'Days', format: 'number', numeric: true },
      ],
      rows: rows.map((row) => ({
        createdAt: row.createdAt.toISOString().slice(0, 10),
        property: row.property.name,
        unit: row.unit?.unitNumber ?? null,
        title: row.title,
        priority: row.priority,
        status: row.status,
        assignedTo: row.assignedTo?.fullName ?? null,
        estimatedCost: row.estimatedCost ? serialiseMoney(row.estimatedCost) : null,
        actualCost: row.actualCost ? serialiseMoney(row.actualCost) : null,
        // How long it took, or how long it has been waiting.
        daysOpen: Math.round(
          ((row.completedAt ?? new Date()).getTime() - row.createdAt.getTime()) / 86_400_000,
        ),
      })),
      totals: {
        estimatedCost: serialiseMoney(aggregate._sum.estimatedCost),
        actualCost: serialiseMoney(aggregate._sum.actualCost),
      },
      meta: {
        total,
        page: context.filters.page ?? 1,
        limit: context.take,
        byStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
      },
    };
  }
}

@Injectable()
export class LeaseExpiryReport implements ReportStrategy {
  readonly key = 'lease-expiry';
  readonly title = 'Lease expiry';
  readonly description = 'What is ending, and when — the renewals worklist.';
  readonly filters = ['dateFrom', 'dateTo', 'propertyId', 'status'];

  async run(context: ReportContext): Promise<ReportResult> {
    const today = todayUtc();
    const range = dateWindow(context);

    const where: Prisma.LeaseWhereInput = {
      ...context.scopeWhere,
      ...(context.filters.propertyId ? { propertyId: context.filters.propertyId } : {}),
      ...(context.filters.unitId ? { unitId: context.filters.unitId } : {}),
      ...(context.filters.tenantId ? { tenantId: context.filters.tenantId } : {}),
      ...(context.filters.status
        ? { status: context.filters.status as Prisma.LeaseWhereInput['status'] }
        : // Terminated leases are not "expiring"; they are over.
          { status: { in: ['ACTIVE', 'EXPIRING_SOON', 'EXPIRED'] } }),
      // An open-ended lease has no expiry, so it has no place on this report.
      endDate: { not: null, ...(range ?? {}) },
    };

    const [rows, total, aggregate] = await Promise.all([
      context.db.lease.findMany({
        where,
        orderBy: [{ endDate: 'asc' }],
        skip: context.skip,
        take: context.take,
        select: {
          startDate: true,
          endDate: true,
          monthlyRent: true,
          status: true,
          tenant: { select: { fullName: true, phone: true } },
          unit: { select: { unitNumber: true } },
          property: { select: { name: true } },
        },
      }),
      context.db.lease.count({ where }),
      context.db.lease.aggregate({ where, _sum: { monthlyRent: true } }),
    ]);

    return {
      columns: [
        { key: 'tenant', label: 'Tenant' },
        { key: 'phone', label: 'Phone' },
        { key: 'property', label: 'Property' },
        { key: 'unit', label: 'Unit' },
        { key: 'startDate', label: 'Start', format: 'date' },
        { key: 'endDate', label: 'Ends', format: 'date' },
        { key: 'daysRemaining', label: 'Days left', format: 'number', numeric: true },
        { key: 'monthlyRent', label: 'Rent', format: 'money', numeric: true },
        { key: 'status', label: 'Status' },
      ],
      rows: rows.map((row) => ({
        tenant: row.tenant.fullName,
        phone: row.tenant.phone,
        property: row.property.name,
        unit: row.unit.unitNumber,
        startDate: row.startDate.toISOString().slice(0, 10),
        endDate: row.endDate?.toISOString().slice(0, 10) ?? null,
        // Negative once it has passed, which is the honest way to show a lease
        // that has run over.
        daysRemaining: row.endDate
          ? Math.round((row.endDate.getTime() - today.getTime()) / 86_400_000)
          : null,
        monthlyRent: serialiseMoney(row.monthlyRent),
        status: row.status,
      })),
      totals: { monthlyRent: serialiseMoney(aggregate._sum.monthlyRent) },
      meta: { total, page: context.filters.page ?? 1, limit: context.take },
    };
  }
}

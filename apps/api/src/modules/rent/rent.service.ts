import { Injectable } from '@nestjs/common';
import { Prisma } from '@pm/database';
import { paginated } from '@/common/dto/pagination.dto';
import { NotFoundError } from '@/common/errors/domain.errors';
import { serialiseMoney, toDecimal } from '@/common/money/money';
import { AUDIT_ACTIONS, AuditLogService } from '@/modules/audit-logs/audit-log.service';
import { parseDateOnly, todayUtc } from '@/modules/leases/lease-dates';
import { InjectScopedPrisma } from '@/prisma/prisma.module';
import type { ScopedPrismaClient } from '@/prisma/tenant-scope.extension';
import { PropertyScopeService } from '@/tenancy/property-scope.service';
import { TenantContextService } from '@/tenancy/tenant-context.service';
import type {
  GenerateRentDto,
  ListRentQueryDto,
  OutstandingRentQueryDto,
  RentSummaryQueryDto,
} from './dto/rent.dto';
import { FinanceCalculationService } from './finance-calculation.service';
import { RentGenerationService } from './rent-generation.service';
import { currentPeriod, periodFromLabel } from './rent-period';

const RENT_SELECT = {
  id: true,
  leaseId: true,
  tenantId: true,
  propertyId: true,
  unitId: true,
  periodStart: true,
  periodEnd: true,
  periodLabel: true,
  expectedAmount: true,
  paidAmount: true,
  balance: true,
  dueDate: true,
  status: true,
  createdAt: true,
  tenant: { select: { id: true, fullName: true, phone: true } },
  unit: { select: { id: true, unitNumber: true } },
  property: { select: { id: true, name: true } },
} satisfies Prisma.RentRecordSelect;

type RentRow = Prisma.RentRecordGetPayload<{ select: typeof RENT_SELECT }>;

@Injectable()
export class RentService {
  constructor(
    @InjectScopedPrisma() private readonly db: ScopedPrismaClient,
    private readonly scope: PropertyScopeService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditLogService,
    private readonly generation: RentGenerationService,
    private readonly finance: FinanceCalculationService,
  ) {}

  private serialise(record: RentRow) {
    return {
      ...record,
      expectedAmount: serialiseMoney(record.expectedAmount),
      paidAmount: serialiseMoney(record.paidAmount),
      balance: serialiseMoney(record.balance),
      /** Derived on read: how late this charge is, today. */
      daysOverdue:
        record.balance.greaterThan(0) && record.dueDate < todayUtc()
          ? Math.round((todayUtc().getTime() - record.dueDate.getTime()) / 86_400_000)
          : 0,
    };
  }

  async list(query: ListRentQueryDto) {
    if (query.propertyId) this.scope.assertProperty(query.propertyId, 'Rent record');

    const where: Prisma.RentRecordWhereInput = {
      ...this.scope.where(),
      ...(query.period ? { periodLabel: query.period } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.propertyId ? { propertyId: query.propertyId } : {}),
      ...(query.tenantId ? { tenantId: query.tenantId } : {}),
      ...(query.leaseId ? { leaseId: query.leaseId } : {}),
      ...(query.unpaidOnly === 'true' ? { balance: { gt: 0 } } : {}),
      ...(query.search
        ? {
            OR: [
              { tenant: { fullName: { contains: query.search, mode: 'insensitive' } } },
              { unit: { unitNumber: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.db.rentRecord.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { [query.sortBy ?? 'dueDate']: query.sortOrder },
        select: RENT_SELECT,
      }),
      this.db.rentRecord.count({ where }),
    ]);

    return paginated(rows.map((row) => this.serialise(row)), total, query.page, query.limit);
  }

  async findOne(id: string) {
    const record = await this.db.rentRecord.findFirst({
      where: { id, ...this.scope.where() },
      select: {
        ...RENT_SELECT,
        payments: {
          where: { status: 'COMPLETED' },
          orderBy: { paymentDate: 'desc' },
          select: {
            id: true,
            amount: true,
            paymentDate: true,
            paymentMethod: true,
            reference: true,
            createdAt: true,
            receipt: { select: { id: true, receiptNumber: true } },
          },
        },
      },
    });
    if (!record) throw new NotFoundError('Rent record');

    const { payments, ...rest } = record;
    return {
      ...this.serialise(rest),
      payments: payments.map((payment) => ({
        ...payment,
        amount: serialiseMoney(payment.amount),
      })),
    };
  }

  /** The collections worklist: everything still owing, oldest first. */
  async outstanding(query: OutstandingRentQueryDto) {
    if (query.propertyId) this.scope.assertProperty(query.propertyId, 'Rent record');

    const asOf = query.asOf ? parseDateOnly(query.asOf) : todayUtc();

    const where: Prisma.RentRecordWhereInput = {
      ...this.scope.where(),
      ...(query.propertyId ? { propertyId: query.propertyId } : {}),
      balance: { gt: 0 },
      dueDate: { lte: asOf },
    };

    const [rows, total, aggregate] = await Promise.all([
      this.db.rentRecord.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { dueDate: 'asc' },
        select: RENT_SELECT,
      }),
      this.db.rentRecord.count({ where }),
      this.db.rentRecord.aggregate({ where, _sum: { balance: true } }),
    ]);

    return {
      ...paginated(rows.map((row) => this.serialise(row)), total, query.page, query.limit),
      totalOutstanding: serialiseMoney(aggregate._sum.balance),
    };
  }

  /**
   * Expected, collected, outstanding and overdue for a period.
   *
   * "Collected" is summed from completed payments rather than from rent
   * records' paidAmount: the two must agree, and summing the payments is the
   * one that would notice if they ever did not.
   */
  async summary(query: RentSummaryQueryDto) {
    if (query.propertyId) this.scope.assertProperty(query.propertyId, 'Rent record');

    const period = query.period ? periodFromLabel(query.period) : currentPeriod();
    const scopeFilter = this.scope.where();
    const propertyFilter = query.propertyId ? { propertyId: query.propertyId } : {};

    const rentWhere: Prisma.RentRecordWhereInput = {
      ...scopeFilter,
      ...propertyFilter,
      periodLabel: period.periodLabel,
    };

    const [expectedAgg, outstandingAgg, overdueAgg, collectedAgg, counts] = await Promise.all([
      this.db.rentRecord.aggregate({ where: rentWhere, _sum: { expectedAmount: true } }),
      this.db.rentRecord.aggregate({
        where: { ...rentWhere, balance: { gt: 0 } },
        _sum: { balance: true },
      }),
      this.db.rentRecord.aggregate({
        where: { ...rentWhere, balance: { gt: 0 }, dueDate: { lt: todayUtc() } },
        _sum: { balance: true },
      }),
      this.db.payment.aggregate({
        where: {
          ...scopeFilter,
          ...propertyFilter,
          status: 'COMPLETED',
          rentRecord: { periodLabel: period.periodLabel },
        },
        _sum: { amount: true },
      }),
      this.db.rentRecord.groupBy({
        by: ['status'],
        where: rentWhere,
        _count: { _all: true },
      }),
    ]);

    const expected = expectedAgg._sum.expectedAmount ?? toDecimal('0');
    const collected = collectedAgg._sum.amount ?? toDecimal('0');

    return {
      period: period.periodLabel,
      totals: this.finance.rentTotals({
        expected,
        collected,
        outstanding: outstandingAgg._sum.balance ?? toDecimal('0'),
        overdue: overdueAgg._sum.balance ?? toDecimal('0'),
      }),
      counts: Object.fromEntries(counts.map((row) => [row.status, row._count._all])) as Record<
        string,
        number
      >,
      recordCount: counts.reduce((total, row) => total + row._count._all, 0),
    };
  }

  /**
   * Generates this organization's charges for a period.
   *
   * Safe to press twice: the unique index on (leaseId, periodStart) makes the
   * second run a no-op, and the response reports how many were skipped so that
   * is visible rather than mysterious.
   */
  async generate(dto: GenerateRentDto) {
    const auth = this.tenant.getOrThrow();
    const period = dto.period ? periodFromLabel(dto.period) : currentPeriod();

    // The caller's own scope, from the session — never anything they sent.
    const result = await this.generation.generateForOrganization(
      auth.organizationId,
      period,
      auth.scopedPropertyIds,
    );
    await this.generation.markOverdue(auth.organizationId);

    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.RENT_GENERATED,
      entityType: 'RentRecord',
      metadata: {
        period: result.periodLabel,
        created: result.created,
        skipped: result.skipped,
        expiredLeasesSkipped: result.expiredLeasesSkipped,
      },
    });

    return result;
  }
}

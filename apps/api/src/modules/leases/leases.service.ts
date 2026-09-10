import { Injectable } from '@nestjs/common';
import { Prisma } from '@pm/database';
import { paginated } from '@/common/dto/pagination.dto';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/common/errors/domain.errors';
import { serialiseMoney, toDecimal } from '@/common/money/money';
import { AUDIT_ACTIONS, AuditLogService } from '@/modules/audit-logs/audit-log.service';
import { InjectScopedPrisma } from '@/prisma/prisma.module';
import type { ScopedPrismaClient } from '@/prisma/tenant-scope.extension';
import { PropertyScopeService } from '@/tenancy/property-scope.service';
import { TenantContextService } from '@/tenancy/tenant-context.service';
import type {
  CreateLeaseDto,
  ExpiringLeasesQueryDto,
  ListLeasesQueryDto,
  RenewLeaseDto,
  TerminateLeaseDto,
  UpdateLeaseDto,
} from './dto/lease.dto';
import { addDays, daysUntil, parseDateOnly, todayUtc } from './lease-dates';

const LEASE_SELECT = {
  id: true,
  tenantId: true,
  propertyId: true,
  buildingId: true,
  unitId: true,
  startDate: true,
  endDate: true,
  monthlyRent: true,
  securityDeposit: true,
  depositPaid: true,
  dueDay: true,
  status: true,
  terminatedAt: true,
  terminationReason: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  tenant: { select: { id: true, fullName: true, phone: true } },
  unit: { select: { id: true, unitNumber: true, unitType: true } },
  building: { select: { id: true, name: true } },
  property: { select: { id: true, name: true } },
} satisfies Prisma.LeaseSelect;

type LeaseRow = Prisma.LeaseGetPayload<{ select: typeof LEASE_SELECT }>;

/** Statuses that occupy a unit. A unit with one of these is not available. */
const LIVE_STATUSES = ['ACTIVE', 'EXPIRING_SOON'] as const;

/** A unit can only be leased from one of these. */
const LEASABLE_UNIT_STATUSES = ['VACANT', 'RESERVED'] as const;

@Injectable()
export class LeasesService {
  constructor(
    @InjectScopedPrisma() private readonly db: ScopedPrismaClient,
    private readonly scope: PropertyScopeService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditLogService,
  ) {}

  private serialise(lease: LeaseRow) {
    return {
      ...lease,
      monthlyRent: serialiseMoney(lease.monthlyRent),
      securityDeposit: serialiseMoney(lease.securityDeposit),
      depositPaid: serialiseMoney(lease.depositPaid),
      /** Derived on read so it is never a stale stored value. */
      daysUntilExpiry: daysUntil(lease.endDate),
      depositOutstanding: serialiseMoney(
        lease.securityDeposit.minus(lease.depositPaid),
      ),
    };
  }

  async list(query: ListLeasesQueryDto) {
    if (query.propertyId) this.scope.assertProperty(query.propertyId, 'Lease');

    const where: Prisma.LeaseWhereInput = {
      ...this.scope.where(),
      ...(query.status ? { status: query.status } : {}),
      ...(query.propertyId ? { propertyId: query.propertyId } : {}),
      ...(query.tenantId ? { tenantId: query.tenantId } : {}),
      ...(query.unitId ? { unitId: query.unitId } : {}),
      ...(query.endingBefore ? { endDate: { lte: parseDateOnly(query.endingBefore) } } : {}),
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
      this.db.lease.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { [query.sortBy ?? 'startDate']: query.sortOrder },
        select: LEASE_SELECT,
      }),
      this.db.lease.count({ where }),
    ]);

    return paginated(rows.map((row) => this.serialise(row)), total, query.page, query.limit);
  }

  /** The renewals worklist: live leases ending within `days`. */
  async expiring(query: ExpiringLeasesQueryDto) {
    const days = query.days ?? 60;
    const rows = await this.db.lease.findMany({
      where: {
        ...this.scope.where(),
        status: { in: [...LIVE_STATUSES] },
        endDate: { not: null, gte: todayUtc(), lte: addDays(todayUtc(), days) },
      },
      orderBy: { endDate: 'asc' },
      take: 200,
      select: LEASE_SELECT,
    });

    return { days, data: rows.map((row) => this.serialise(row)) };
  }

  async findOne(id: string) {
    const lease = await this.db.lease.findFirst({
      where: { id, ...this.scope.where() },
      select: LEASE_SELECT,
    });
    if (!lease) throw new NotFoundError('Lease');
    return this.serialise(lease);
  }

  /**
   * Moving a tenant in.
   *
   * Lease creation and the unit's status change are one transaction: a lease
   * without an occupied unit, or an occupied unit without a lease, are both
   * states nothing else in the system knows how to interpret.
   */
  async create(dto: CreateLeaseDto) {
    const auth = this.tenant.getOrThrow();

    const tenant = await this.db.tenant.findFirst({
      where: { id: dto.tenantId },
      select: { id: true, fullName: true, isActive: true },
    });
    if (!tenant) throw new NotFoundError('Tenant');
    if (!tenant.isActive) {
      throw new ConflictError(
        'TENANT_INACTIVE',
        'This tenant is deactivated. Reactivate them before creating a lease.',
      );
    }

    const unit = await this.db.unit.findFirst({
      where: { id: dto.unitId, ...this.scope.where() },
      select: {
        id: true,
        unitNumber: true,
        status: true,
        propertyId: true,
        buildingId: true,
        monthlyRent: true,
        securityDeposit: true,
      },
    });
    if (!unit) throw new NotFoundError('Unit');

    if (!(LEASABLE_UNIT_STATUSES as readonly string[]).includes(unit.status)) {
      throw new ConflictError(
        'UNIT_NOT_AVAILABLE',
        unit.status === 'OCCUPIED'
          ? `Unit ${unit.unitNumber} is already occupied. End the existing lease first.`
          : `Unit ${unit.unitNumber} is ${unit.status.toLowerCase()} and cannot be leased.`,
        [{ field: 'unitId', message: 'Choose an available unit.' }],
      );
    }

    const startDate = parseDateOnly(dto.startDate);
    const endDate = dto.endDate ? parseDateOnly(dto.endDate) : null;
    this.assertDatesCoherent(startDate, endDate);

    // Rent and deposit are copied from the unit at this moment, not read
    // through it: raising a unit's rent later must not rewrite what a sitting
    // tenant agreed to pay.
    const monthlyRent = toDecimal(dto.monthlyRent ?? unit.monthlyRent.toString());
    const securityDeposit = toDecimal(dto.securityDeposit ?? unit.securityDeposit.toString());
    const depositPaid = toDecimal(dto.depositPaid ?? '0');
    this.assertDepositCoherent(securityDeposit, depositPaid);

    try {
      const lease = await this.db.$transaction(async (tx) => {
        const created = await tx.lease.create({
          data: {
            organizationId: auth.organizationId,
            tenantId: tenant.id,
            propertyId: unit.propertyId,
            buildingId: unit.buildingId,
            unitId: unit.id,
            startDate,
            endDate,
            monthlyRent,
            securityDeposit,
            depositPaid,
            dueDay: dto.dueDay,
            status: 'ACTIVE',
            notes: dto.notes ?? null,
            createdById: auth.userId,
          },
          select: LEASE_SELECT,
        });

        await tx.unit.update({ where: { id: unit.id }, data: { status: 'OCCUPIED' } });
        return created;
      });

      await this.audit.record({
        organizationId: auth.organizationId,
        userId: auth.userId,
        actorEmail: auth.email,
        action: AUDIT_ACTIONS.LEASE_CREATED,
        entityType: 'Lease',
        entityId: lease.id,
        metadata: {
          tenant: tenant.fullName,
          unit: unit.unitNumber,
          monthlyRent: serialiseMoney(monthlyRent),
          startDate: dto.startDate,
          endDate: dto.endDate ?? null,
        },
      });

      return this.serialise(lease);
    } catch (error) {
      // Two simultaneous requests can both pass the status check above; only
      // one can win the partial unique index on (unitId) WHERE status='ACTIVE'.
      // The loser gets the same message it would have got a moment earlier.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictError(
          'UNIT_NOT_AVAILABLE',
          `Unit ${unit.unitNumber} was leased by someone else a moment ago. Refresh and choose another unit.`,
          [{ field: 'unitId', message: 'This unit is no longer available.' }],
        );
      }
      throw error;
    }
  }

  /** Terms only. Who and where a lease is for are fixed for its lifetime. */
  async update(id: string, dto: UpdateLeaseDto) {
    const auth = this.tenant.getOrThrow();
    const current = await this.db.lease.findFirst({
      where: { id, ...this.scope.where() },
      select: {
        id: true,
        status: true,
        startDate: true,
        securityDeposit: true,
        depositPaid: true,
      },
    });
    if (!current) throw new NotFoundError('Lease');

    if (current.status === 'TERMINATED') {
      throw new ConflictError(
        'LEASE_TERMINATED',
        'A terminated lease is part of the record and cannot be edited.',
      );
    }

    const endDate = dto.endDate ? parseDateOnly(dto.endDate) : undefined;
    if (endDate) this.assertDatesCoherent(current.startDate, endDate);

    if (dto.depositPaid !== undefined) {
      this.assertDepositCoherent(current.securityDeposit, toDecimal(dto.depositPaid));
    }

    await this.db.lease.update({
      where: { id },
      data: {
        ...(endDate !== undefined ? { endDate } : {}),
        ...(dto.monthlyRent !== undefined ? { monthlyRent: toDecimal(dto.monthlyRent) } : {}),
        ...(dto.depositPaid !== undefined ? { depositPaid: toDecimal(dto.depositPaid) } : {}),
        ...(dto.dueDay !== undefined ? { dueDay: dto.dueDay } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
    });

    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.LEASE_UPDATED,
      entityType: 'Lease',
      entityId: id,
      metadata: { changed: Object.keys(dto) },
    });

    return this.findOne(id);
  }

  /**
   * Extends the term in place.
   *
   * An EXPIRED lease can be renewed — that is the normal case, since a tenant
   * usually stays past the end date while the paperwork catches up. Renewing
   * puts it back to ACTIVE, which is why the unit was never freed on expiry.
   */
  async renew(id: string, dto: RenewLeaseDto) {
    const auth = this.tenant.getOrThrow();
    const current = await this.db.lease.findFirst({
      where: { id, ...this.scope.where() },
      select: {
        id: true,
        status: true,
        startDate: true,
        endDate: true,
        monthlyRent: true,
        unitId: true,
      },
    });
    if (!current) throw new NotFoundError('Lease');

    if (current.status === 'TERMINATED') {
      throw new ConflictError(
        'LEASE_TERMINATED',
        'This lease was terminated. Create a new lease instead of renewing it.',
      );
    }

    const endDate = parseDateOnly(dto.endDate);
    this.assertDatesCoherent(current.startDate, endDate);

    if (current.endDate && endDate <= current.endDate) {
      throw new ValidationError('A renewal must extend the lease.', [
        {
          field: 'endDate',
          message: `Choose a date after ${current.endDate.toISOString().slice(0, 10)}.`,
        },
      ]);
    }

    // Re-activating cannot collide: this lease already holds the unit, and the
    // partial unique index would refuse a second active lease on it anyway.
    await this.db.lease.update({
      where: { id },
      data: {
        endDate,
        status: 'ACTIVE',
        ...(dto.monthlyRent !== undefined ? { monthlyRent: toDecimal(dto.monthlyRent) } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
    });

    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.LEASE_RENEWED,
      entityType: 'Lease',
      entityId: id,
      metadata: {
        previousEndDate: current.endDate?.toISOString().slice(0, 10) ?? null,
        newEndDate: dto.endDate,
        previousRent: serialiseMoney(current.monthlyRent),
        newRent: dto.monthlyRent ?? serialiseMoney(current.monthlyRent),
      },
    });

    return this.findOne(id);
  }

  /**
   * Moving a tenant out.
   *
   * The lease closes and the unit is freed in one transaction. The lease is
   * never deleted: it is the record of who lived there and on what terms, and
   * it is also what past rent records were billed against.
   */
  async terminate(id: string, dto: TerminateLeaseDto) {
    const auth = this.tenant.getOrThrow();
    const current = await this.db.lease.findFirst({
      where: { id, ...this.scope.where() },
      select: {
        id: true,
        status: true,
        unitId: true,
        tenant: { select: { fullName: true } },
        unit: { select: { unitNumber: true } },
      },
    });
    if (!current) throw new NotFoundError('Lease');

    if (current.status === 'TERMINATED') {
      throw new ConflictError('LEASE_TERMINATED', 'This lease has already been terminated.');
    }

    const unitStatus = dto.unitStatus ?? 'VACANT';

    await this.db.$transaction(async (tx) => {
      await tx.lease.update({
        where: { id },
        data: {
          status: 'TERMINATED',
          terminatedAt: new Date(),
          terminationReason: dto.reason ?? null,
        },
      });
      await tx.unit.update({ where: { id: current.unitId }, data: { status: unitStatus } });
    });

    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.LEASE_TERMINATED,
      entityType: 'Lease',
      entityId: id,
      metadata: {
        tenant: current.tenant.fullName,
        unit: current.unit.unitNumber,
        reason: dto.reason ?? null,
        unitStatus,
      },
    });

    return this.findOne(id);
  }

  private assertDatesCoherent(startDate: Date, endDate: Date | null | undefined): void {
    if (Number.isNaN(startDate.getTime())) {
      throw new ValidationError('The start date is not a valid date.', [
        { field: 'startDate', message: 'Enter a date such as 2026-01-01.' },
      ]);
    }
    if (endDate && Number.isNaN(endDate.getTime())) {
      throw new ValidationError('The end date is not a valid date.', [
        { field: 'endDate', message: 'Enter a date such as 2026-12-31.' },
      ]);
    }
    if (endDate && endDate <= startDate) {
      throw new ValidationError('A lease cannot end before it starts.', [
        { field: 'endDate', message: 'The end date must be after the start date.' },
      ]);
    }
  }

  private assertDepositCoherent(securityDeposit: Prisma.Decimal, depositPaid: Prisma.Decimal): void {
    if (depositPaid.greaterThan(securityDeposit)) {
      throw new ValidationError('More deposit has been recorded than the lease requires.', [
        {
          field: 'depositPaid',
          message: `Cannot exceed the security deposit of ${serialiseMoney(securityDeposit)}.`,
        },
      ]);
    }
  }
}

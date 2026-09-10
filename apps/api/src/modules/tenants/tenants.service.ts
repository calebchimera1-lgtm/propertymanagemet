import { Injectable } from '@nestjs/common';
import type { Prisma } from '@pm/database';
import { paginated } from '@/common/dto/pagination.dto';
import { ConflictError, NotFoundError } from '@/common/errors/domain.errors';
import { serialiseMoney } from '@/common/money/money';
import { AUDIT_ACTIONS, AuditLogService } from '@/modules/audit-logs/audit-log.service';
import { InjectScopedPrisma } from '@/prisma/prisma.module';
import type { ScopedPrismaClient } from '@/prisma/tenant-scope.extension';
import { PropertyScopeService } from '@/tenancy/property-scope.service';
import { TenantContextService } from '@/tenancy/tenant-context.service';
import type { CreateTenantDto, ListTenantsQueryDto, UpdateTenantDto } from './dto/tenant.dto';

const TENANT_SELECT = {
  id: true,
  fullName: true,
  phone: true,
  email: true,
  idType: true,
  nationalId: true,
  emergencyContactName: true,
  emergencyContactPhone: true,
  occupation: true,
  address: true,
  photoUrl: true,
  notes: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TenantSelect;

/** Statuses that mean "this tenant is currently in a unit". */
const LIVE_LEASE_STATUSES = ['ACTIVE', 'EXPIRING_SOON'] as const;

@Injectable()
export class TenantsService {
  constructor(
    @InjectScopedPrisma() private readonly db: ScopedPrismaClient,
    private readonly scope: PropertyScopeService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * A tenant belongs to the organization, not to a property — so property scope
   * cannot be applied to the Tenant row directly. It is applied through the
   * tenant's leases instead: a caretaker assigned to one property sees the
   * people leasing there, and nobody else.
   */
  private scopeFilter(): Prisma.TenantWhereInput {
    const propertyFilter = this.scope.where();
    if (!propertyFilter.propertyId) return {};
    return { leases: { some: { propertyId: propertyFilter.propertyId } } };
  }

  async list(query: ListTenantsQueryDto) {
    if (query.propertyId) this.scope.assertProperty(query.propertyId, 'Tenant');

    const where: Prisma.TenantWhereInput = {
      ...this.scopeFilter(),
      ...(query.isActive ? { isActive: query.isActive === 'true' } : {}),
      ...(query.propertyId ? { leases: { some: { propertyId: query.propertyId } } } : {}),
      ...(query.hasActiveLease === 'true'
        ? { leases: { some: { status: { in: [...LIVE_LEASE_STATUSES] } } } }
        : {}),
      ...(query.hasActiveLease === 'false'
        ? { leases: { none: { status: { in: [...LIVE_LEASE_STATUSES] } } } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { fullName: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
              { nationalId: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.db.tenant.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder },
        select: {
          ...TENANT_SELECT,
          leases: {
            where: { status: { in: [...LIVE_LEASE_STATUSES] } },
            take: 1,
            orderBy: { startDate: 'desc' },
            select: {
              id: true,
              status: true,
              monthlyRent: true,
              endDate: true,
              unit: { select: { id: true, unitNumber: true } },
              property: { select: { id: true, name: true } },
            },
          },
        },
      }),
      this.db.tenant.count({ where }),
    ]);

    const data = rows.map(({ leases, ...tenant }) => {
      const current = leases[0];
      return {
        ...tenant,
        currentLease: current
          ? {
              id: current.id,
              status: current.status,
              monthlyRent: serialiseMoney(current.monthlyRent),
              endDate: current.endDate,
              unit: current.unit,
              property: current.property,
            }
          : null,
      };
    });

    return paginated(data, total, query.page, query.limit);
  }

  async findOne(id: string) {
    const tenant = await this.db.tenant.findFirst({
      where: { id, ...this.scopeFilter() },
      select: TENANT_SELECT,
    });
    if (!tenant) throw new NotFoundError('Tenant');
    return tenant;
  }

  /**
   * The tenant 360 view: who they are, where they live, and what has happened.
   *
   * Rent, payments and outstanding balance are the obvious next sections and
   * are deliberately absent — they arrive with the money models in Phase 4.
   * The response says so explicitly rather than returning empty arrays that
   * look like "nothing owed".
   */
  async profile(id: string) {
    const tenant = await this.findOne(id);

    const leases = await this.db.lease.findMany({
      where: { tenantId: id },
      orderBy: [{ startDate: 'desc' }],
      select: {
        id: true,
        status: true,
        startDate: true,
        endDate: true,
        monthlyRent: true,
        securityDeposit: true,
        depositPaid: true,
        dueDay: true,
        terminatedAt: true,
        terminationReason: true,
        createdAt: true,
        unit: { select: { id: true, unitNumber: true, unitType: true } },
        building: { select: { id: true, name: true } },
        property: { select: { id: true, name: true } },
      },
    });

    const serialised = leases.map((lease) => ({
      ...lease,
      monthlyRent: serialiseMoney(lease.monthlyRent),
      securityDeposit: serialiseMoney(lease.securityDeposit),
      depositPaid: serialiseMoney(lease.depositPaid),
    }));

    const current = serialised.find((lease) =>
      (LIVE_LEASE_STATUSES as readonly string[]).includes(lease.status),
    );

    return {
      tenant,
      currentLease: current ?? null,
      leaseHistory: serialised,
      leaseCount: serialised.length,
      // Named explicitly so the UI can say "arrives in Phase 4" rather than
      // rendering a zero balance that would read as "nothing owed".
      finances: { available: false, reason: 'Rent and payments arrive in Phase 4.' },
    };
  }

  async create(dto: CreateTenantDto) {
    const auth = this.tenant.getOrThrow();

    if (dto.nationalId) await this.assertNationalIdFree(dto.nationalId);

    const tenant = await this.db.tenant.create({
      data: {
        organizationId: auth.organizationId,
        fullName: dto.fullName,
        phone: dto.phone,
        email: dto.email ?? null,
        idType: dto.idType ?? null,
        nationalId: dto.nationalId ?? null,
        emergencyContactName: dto.emergencyContactName ?? null,
        emergencyContactPhone: dto.emergencyContactPhone ?? null,
        occupation: dto.occupation ?? null,
        address: dto.address ?? null,
        notes: dto.notes ?? null,
      },
      select: TENANT_SELECT,
    });

    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.TENANT_CREATED,
      entityType: 'Tenant',
      entityId: tenant.id,
      metadata: { fullName: tenant.fullName },
    });

    return { ...tenant, currentLease: null };
  }

  async update(id: string, dto: UpdateTenantDto) {
    const auth = this.tenant.getOrThrow();
    const current = await this.findOne(id);

    if (dto.nationalId && dto.nationalId !== current.nationalId) {
      await this.assertNationalIdFree(dto.nationalId, id);
    }

    await this.db.tenant.update({ where: { id }, data: { ...dto } });

    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.TENANT_UPDATED,
      entityType: 'Tenant',
      entityId: id,
      metadata: { changed: Object.keys(dto) },
    });

    return this.findOne(id);
  }

  /**
   * Hard delete, and only for a tenant with no history at all.
   *
   * Once someone has held a lease they are part of the record — from Phase 4,
   * part of the financial record. Deactivating hides them; deleting is reserved
   * for a row created by mistake.
   */
  async remove(id: string): Promise<void> {
    const auth = this.tenant.getOrThrow();
    const tenant = await this.findOne(id);

    const leaseCount = await this.db.lease.count({ where: { tenantId: id } });
    if (leaseCount > 0) {
      throw new ConflictError(
        'TENANT_HAS_HISTORY',
        `This tenant has ${leaseCount} lease record(s) and cannot be deleted. ` +
          'Deactivate them instead — their history stays intact.',
      );
    }

    await this.db.tenant.delete({ where: { id } });

    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.TENANT_DELETED,
      entityType: 'Tenant',
      entityId: id,
      metadata: { fullName: tenant.fullName },
    });
  }

  /** The database enforces this; checking here turns it into a field error. */
  private async assertNationalIdFree(nationalId: string, excludeId?: string): Promise<void> {
    const clash = await this.db.tenant.findFirst({
      where: { nationalId, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictError(
        'TENANT_ID_TAKEN',
        'Another tenant is already recorded with that ID number.',
        [{ field: 'nationalId', message: 'This ID number is already on file.' }],
      );
    }
  }
}

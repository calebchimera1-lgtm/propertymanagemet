import { Injectable } from '@nestjs/common';
import type { Prisma } from '@pm/database';
import { paginated } from '@/common/dto/pagination.dto';
import { serialiseMoney } from '@/common/money/money';
import { ConflictError, NotFoundError } from '@/common/errors/domain.errors';
import { AUDIT_ACTIONS, AuditLogService } from '@/modules/audit-logs/audit-log.service';
import { InjectScopedPrisma } from '@/prisma/prisma.module';
import type { ScopedPrismaClient } from '@/prisma/tenant-scope.extension';
import { PropertyScopeService } from '@/tenancy/property-scope.service';
import { TenantContextService } from '@/tenancy/tenant-context.service';
import type {
  CreatePropertyDto,
  ListPropertiesQueryDto,
  UpdatePropertyDto,
} from './dto/property.dto';

const PROPERTY_SELECT = {
  id: true,
  name: true,
  propertyType: true,
  description: true,
  addressLine: true,
  city: true,
  county: true,
  country: true,
  latitude: true,
  longitude: true,
  imageUrl: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PropertySelect;

@Injectable()
export class PropertiesService {
  constructor(
    @InjectScopedPrisma() private readonly db: ScopedPrismaClient,
    private readonly scope: PropertyScopeService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditLogService,
  ) {}

  async list(query: ListPropertiesQueryDto) {
    const where: Prisma.PropertyWhereInput = {
      // Organization comes from the tenant-scoped client; property scope is
      // composed in here so a caretaker's list is narrowed at the database.
      ...this.scope.whereProperty(),
      ...(query.propertyType ? { propertyType: query.propertyType } : {}),
      ...(query.status ? { status: query.status } : { status: { not: 'ARCHIVED' } }),
      ...(query.city ? { city: { contains: query.city, mode: 'insensitive' } } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { addressLine: { contains: query.search, mode: 'insensitive' } },
              { city: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.db.property.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder },
        select: {
          ...PROPERTY_SELECT,
          _count: { select: { buildings: true, units: true } },
        },
      }),
      this.db.property.count({ where }),
    ]);

    const data = rows.map(({ _count, ...property }) => ({
      ...property,
      buildingCount: _count.buildings,
      unitCount: _count.units,
    }));

    return paginated(data, total, query.page, query.limit);
  }

  async findOne(id: string) {
    // Scope first: a property outside the caller's assignments must read as
    // absent, not as forbidden.
    this.scope.assertProperty(id);

    const property = await this.db.property.findFirst({
      where: { id },
      select: {
        ...PROPERTY_SELECT,
        _count: { select: { buildings: true, units: true } },
      },
    });
    if (!property) throw new NotFoundError('Property');

    const { _count, ...rest } = property;
    return { ...rest, buildingCount: _count.buildings, unitCount: _count.units };
  }

  /** Counts and rent totals for one property's overview tab. */
  async summary(id: string) {
    this.scope.assertProperty(id);
    const property = await this.findOne(id);

    const [statusGroups, rentAggregate] = await Promise.all([
      this.db.unit.groupBy({
        by: ['status'],
        where: { propertyId: id },
        _count: { _all: true },
      }),
      this.db.unit.aggregate({
        where: { propertyId: id },
        _sum: { monthlyRent: true },
      }),
    ]);

    const byStatus = Object.fromEntries(
      statusGroups.map((group) => [group.status, group._count._all]),
    ) as Record<string, number>;

    const totalUnits = statusGroups.reduce((sum, group) => sum + group._count._all, 0);
    const occupied = byStatus.OCCUPIED ?? 0;

    return {
      property,
      units: {
        total: totalUnits,
        vacant: byStatus.VACANT ?? 0,
        occupied,
        reserved: byStatus.RESERVED ?? 0,
        maintenance: byStatus.MAINTENANCE ?? 0,
        unavailable: byStatus.UNAVAILABLE ?? 0,
      },
      // Occupancy is a ratio of real counts. It is 0 when there are no units —
      // never a division by zero dressed up as a percentage.
      occupancyRate: totalUnits === 0 ? 0 : Math.round((occupied / totalUnits) * 10000) / 100,
      // A Decimal, serialised as a fixed-scale string. It is the rent the
      // property would bill at full occupancy, not money anybody has collected.
      potentialMonthlyRent: serialiseMoney(rentAggregate._sum.monthlyRent),
    };
  }

  async create(dto: CreatePropertyDto) {
    const auth = this.tenant.getOrThrow();

    // A scoped user cannot create a property: they would immediately be unable
    // to see it, since scope comes from assignments an owner grants.
    const existing = await this.db.property.findFirst({
      where: { name: dto.name },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictError(
        'PROPERTY_NAME_TAKEN',
        'A property with that name already exists in your organization.',
        [{ field: 'name', message: 'This name is already in use.' }],
      );
    }

    const property = await this.db.property.create({
      data: {
      // organizationId is passed explicitly so the Prisma types line up; the
      // tenant extension overwrites it with the same session-derived value, so
      // this is a type-level convenience, not a second source of truth.
        organizationId: auth.organizationId,
        name: dto.name,
        propertyType: dto.propertyType,
        description: dto.description ?? null,
        addressLine: dto.addressLine ?? null,
        city: dto.city ?? null,
        county: dto.county ?? null,
        country: dto.country ?? 'Kenya',
        latitude: dto.latitude ?? null,
        longitude: dto.longitude ?? null,
      },
      select: PROPERTY_SELECT,
    });

    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.PROPERTY_CREATED,
      entityType: 'Property',
      entityId: property.id,
      metadata: { name: property.name, propertyType: property.propertyType },
    });

    return { ...property, buildingCount: 0, unitCount: 0 };
  }

  async update(id: string, dto: UpdatePropertyDto) {
    const auth = this.tenant.getOrThrow();
    this.scope.assertProperty(id);

    const current = await this.db.property.findFirst({ where: { id }, select: { id: true } });
    if (!current) throw new NotFoundError('Property');

    if (dto.name) {
      const clash = await this.db.property.findFirst({
        where: { name: dto.name, id: { not: id } },
        select: { id: true },
      });
      if (clash) {
        throw new ConflictError(
          'PROPERTY_NAME_TAKEN',
          'A property with that name already exists in your organization.',
          [{ field: 'name', message: 'This name is already in use.' }],
        );
      }
    }

    await this.db.property.update({ where: { id }, data: { ...dto } });

    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.PROPERTY_UPDATED,
      entityType: 'Property',
      entityId: id,
      metadata: { changed: Object.keys(dto) },
    });

    return this.findOne(id);
  }

  async archive(id: string) {
    const auth = this.tenant.getOrThrow();
    this.scope.assertProperty(id);

    const property = await this.db.property.findFirst({ where: { id }, select: { id: true } });
    if (!property) throw new NotFoundError('Property');

    await this.db.property.update({ where: { id }, data: { status: 'ARCHIVED' } });

    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.PROPERTY_ARCHIVED,
      entityType: 'Property',
      entityId: id,
    });

    return this.findOne(id);
  }

  /**
   * Hard delete, and only when there is nothing to lose.
   *
   * A property with buildings or units is refused with a 409 that names the
   * counts and points at archiving. From Phase 4 the same check will cover
   * financial history, which must never be removed by a convenience action.
   */
  async remove(id: string): Promise<void> {
    const auth = this.tenant.getOrThrow();
    this.scope.assertProperty(id);

    const property = await this.db.property.findFirst({
      where: { id },
      select: { id: true, name: true, _count: { select: { buildings: true, units: true } } },
    });
    if (!property) throw new NotFoundError('Property');

    if (property._count.buildings > 0 || property._count.units > 0) {
      throw new ConflictError(
        'PROPERTY_NOT_EMPTY',
        `This property still has ${property._count.buildings} building(s) and ${property._count.units} unit(s). ` +
          'Archive it instead, or remove its units first.',
      );
    }

    await this.db.property.delete({ where: { id } });

    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.PROPERTY_DELETED,
      entityType: 'Property',
      entityId: id,
      metadata: { name: property.name },
    });
  }
}

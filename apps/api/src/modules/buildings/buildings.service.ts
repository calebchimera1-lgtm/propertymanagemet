import { Injectable } from '@nestjs/common';
import type { Prisma } from '@pm/database';
import { paginated } from '@/common/dto/pagination.dto';
import { ConflictError, NotFoundError } from '@/common/errors/domain.errors';
import { AUDIT_ACTIONS, AuditLogService } from '@/modules/audit-logs/audit-log.service';
import { InjectScopedPrisma } from '@/prisma/prisma.module';
import type { ScopedPrismaClient } from '@/prisma/tenant-scope.extension';
import { PropertyScopeService } from '@/tenancy/property-scope.service';
import { TenantContextService } from '@/tenancy/tenant-context.service';
import type {
  CreateBuildingDto,
  ListBuildingsQueryDto,
  UpdateBuildingDto,
} from './dto/building.dto';

const BUILDING_SELECT = {
  id: true,
  propertyId: true,
  name: true,
  description: true,
  floors: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  property: { select: { id: true, name: true } },
} satisfies Prisma.BuildingSelect;

@Injectable()
export class BuildingsService {
  constructor(
    @InjectScopedPrisma() private readonly db: ScopedPrismaClient,
    private readonly scope: PropertyScopeService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditLogService,
  ) {}

  async list(query: ListBuildingsQueryDto) {
    if (query.propertyId) this.scope.assertProperty(query.propertyId, 'Building');

    const where: Prisma.BuildingWhereInput = {
      ...this.scope.where(),
      ...(query.propertyId ? { propertyId: query.propertyId } : {}),
      ...(query.status ? { status: query.status } : { status: { not: 'ARCHIVED' } }),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.db.building.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder },
        select: { ...BUILDING_SELECT, _count: { select: { units: true } } },
      }),
      this.db.building.count({ where }),
    ]);

    const data = rows.map(({ _count, ...building }) => ({ ...building, unitCount: _count.units }));
    return paginated(data, total, query.page, query.limit);
  }

  async findOne(id: string) {
    const building = await this.db.building.findFirst({
      where: { id, ...this.scope.where() },
      select: { ...BUILDING_SELECT, _count: { select: { units: true } } },
    });
    if (!building) throw new NotFoundError('Building');

    const { _count, ...rest } = building;
    return { ...rest, unitCount: _count.units };
  }

  async create(dto: CreateBuildingDto) {
    const auth = this.tenant.getOrThrow();
    this.scope.assertProperty(dto.propertyId, 'Property');

    // The property is re-fetched in scope rather than trusted from the body.
    // Even if this check were removed, the composite foreign key on
    // (organizationId, propertyId) makes a cross-organization building
    // impossible at the database level.
    const property = await this.db.property.findFirst({
      where: { id: dto.propertyId },
      select: { id: true },
    });
    if (!property) throw new NotFoundError('Property');

    const clash = await this.db.building.findFirst({
      where: { propertyId: dto.propertyId, name: dto.name },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictError(
        'BUILDING_NAME_TAKEN',
        'A building with that name already exists in this property.',
        [{ field: 'name', message: 'This name is already used in this property.' }],
      );
    }

    const building = await this.db.building.create({
      data: {
      // organizationId is passed explicitly so the Prisma types line up; the
      // tenant extension overwrites it with the same session-derived value, so
      // this is a type-level convenience, not a second source of truth.
        organizationId: auth.organizationId,
        propertyId: dto.propertyId,
        name: dto.name,
        description: dto.description ?? null,
        floors: dto.floors ?? null,
      },
      select: BUILDING_SELECT,
    });

    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.BUILDING_CREATED,
      entityType: 'Building',
      entityId: building.id,
      metadata: { name: building.name, propertyId: dto.propertyId },
    });

    return { ...building, unitCount: 0 };
  }

  async update(id: string, dto: UpdateBuildingDto) {
    const auth = this.tenant.getOrThrow();
    const current = await this.findOne(id);

    if (dto.name && dto.name !== current.name) {
      const clash = await this.db.building.findFirst({
        where: { propertyId: current.propertyId, name: dto.name, id: { not: id } },
        select: { id: true },
      });
      if (clash) {
        throw new ConflictError(
          'BUILDING_NAME_TAKEN',
          'A building with that name already exists in this property.',
          [{ field: 'name', message: 'This name is already used in this property.' }],
        );
      }
    }

    // propertyId is not part of UpdateBuildingDto at all, so there is nothing
    // to strip here — the pipe rejects a request that tries to send it.
    await this.db.building.update({ where: { id }, data: dto });

    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.BUILDING_UPDATED,
      entityType: 'Building',
      entityId: id,
      metadata: { changed: Object.keys(dto) },
    });

    return this.findOne(id);
  }

  /**
   * Deleting a block must not delete its units — those carry the rentable
   * history everything financial will hang off. The units are detached to the
   * property first, and both steps happen in one transaction so a failure
   * cannot leave units pointing at a building that is half gone.
   */
  async remove(id: string): Promise<{ detachedUnits: number }> {
    const auth = this.tenant.getOrThrow();
    const building = await this.findOne(id);

    const detachedUnits = await this.db.$transaction(async (tx) => {
      const detached = await tx.unit.updateMany({
        where: { buildingId: id },
        data: { buildingId: null },
      });
      await tx.building.delete({ where: { id } });
      return detached.count;
    });

    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.BUILDING_DELETED,
      entityType: 'Building',
      entityId: id,
      metadata: { name: building.name, detachedUnits },
    });

    return { detachedUnits };
  }
}

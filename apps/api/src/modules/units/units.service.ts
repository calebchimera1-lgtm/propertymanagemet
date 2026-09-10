import { Injectable } from '@nestjs/common';
import { Prisma } from '@pm/database';
import { paginated } from '@/common/dto/pagination.dto';
import { serialiseMoney, toDecimal } from '@/common/money/money';
import { ConflictError, NotFoundError, ValidationError } from '@/common/errors/domain.errors';
import { AUDIT_ACTIONS, AuditLogService } from '@/modules/audit-logs/audit-log.service';
import { InjectScopedPrisma } from '@/prisma/prisma.module';
import type { ScopedPrismaClient } from '@/prisma/tenant-scope.extension';
import { PropertyScopeService } from '@/tenancy/property-scope.service';
import { TenantContextService } from '@/tenancy/tenant-context.service';
import type {
  CreateUnitDto,
  ListUnitsQueryDto,
  UpdateUnitDto,
  UpdateUnitStatusDto,
} from './dto/unit.dto';

const UNIT_SELECT = {
  id: true,
  propertyId: true,
  buildingId: true,
  unitNumber: true,
  unitType: true,
  floor: true,
  bedrooms: true,
  bathrooms: true,
  monthlyRent: true,
  securityDeposit: true,
  status: true,
  waterMeterNumber: true,
  electricityMeterNumber: true,
  description: true,
  createdAt: true,
  updatedAt: true,
  property: { select: { id: true, name: true } },
  building: { select: { id: true, name: true } },
} satisfies Prisma.UnitSelect;

type UnitRow = Prisma.UnitGetPayload<{ select: typeof UNIT_SELECT }>;

@Injectable()
export class UnitsService {
  constructor(
    @InjectScopedPrisma() private readonly db: ScopedPrismaClient,
    private readonly scope: PropertyScopeService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * Decimal columns become fixed-scale strings on the way out.
   *
   * Serialising them as JSON numbers would quietly hand the browser a float and
   * undo the whole point of storing money as Decimal.
   */
  private serialise(unit: UnitRow) {
    return {
      ...unit,
      monthlyRent: serialiseMoney(unit.monthlyRent),
      securityDeposit: serialiseMoney(unit.securityDeposit),
    };
  }

  async list(query: ListUnitsQueryDto) {
    if (query.propertyId) this.scope.assertProperty(query.propertyId, 'Unit');

    const rentFilter: Prisma.DecimalFilter | undefined =
      query.minRent || query.maxRent
        ? {
            ...(query.minRent ? { gte: toDecimal(query.minRent) } : {}),
            ...(query.maxRent ? { lte: toDecimal(query.maxRent) } : {}),
          }
        : undefined;

    const where: Prisma.UnitWhereInput = {
      ...this.scope.where(),
      ...(query.propertyId ? { propertyId: query.propertyId } : {}),
      ...(query.buildingId ? { buildingId: query.buildingId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.unitType ? { unitType: query.unitType } : {}),
      ...(rentFilter ? { monthlyRent: rentFilter } : {}),
      ...(query.search
        ? {
            OR: [
              { unitNumber: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.db.unit.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder },
        select: UNIT_SELECT,
      }),
      this.db.unit.count({ where }),
    ]);

    return paginated(rows.map((row) => this.serialise(row)), total, query.page, query.limit);
  }

  /** Feed for the lease form's unit picker, and useful on its own. */
  async listVacant(propertyId?: string) {
    if (propertyId) this.scope.assertProperty(propertyId, 'Unit');

    const rows = await this.db.unit.findMany({
      where: {
        ...this.scope.where(),
        ...(propertyId ? { propertyId } : {}),
        status: 'VACANT',
      },
      orderBy: [{ propertyId: 'asc' }, { unitNumber: 'asc' }],
      take: 200,
      select: UNIT_SELECT,
    });

    return rows.map((row) => this.serialise(row));
  }

  async findOne(id: string) {
    const unit = await this.db.unit.findFirst({
      where: { id, ...this.scope.where() },
      select: UNIT_SELECT,
    });
    if (!unit) throw new NotFoundError('Unit');
    return this.serialise(unit);
  }

  async create(dto: CreateUnitDto) {
    const auth = this.tenant.getOrThrow();
    this.scope.assertProperty(dto.propertyId, 'Property');

    const property = await this.db.property.findFirst({
      where: { id: dto.propertyId },
      select: { id: true },
    });
    if (!property) throw new NotFoundError('Property');

    // A building supplied with a unit must belong to the same property, not
    // merely to the same organization.
    if (dto.buildingId) {
      const building = await this.db.building.findFirst({
        where: { id: dto.buildingId },
        select: { id: true, propertyId: true },
      });
      if (!building) throw new NotFoundError('Building');
      if (building.propertyId !== dto.propertyId) {
        throw new ValidationError('That building belongs to a different property.', [
          { field: 'buildingId', message: 'Choose a building inside the selected property.' },
        ]);
      }
    }

    await this.assertUnitNumberFree(dto.propertyId, dto.buildingId ?? null, dto.unitNumber);

    const unit = await this.db.unit.create({
      data: {
      // organizationId is passed explicitly so the Prisma types line up; the
      // tenant extension overwrites it with the same session-derived value, so
      // this is a type-level convenience, not a second source of truth.
        organizationId: auth.organizationId,
        propertyId: dto.propertyId,
        buildingId: dto.buildingId ?? null,
        unitNumber: dto.unitNumber,
        unitType: dto.unitType,
        monthlyRent: toDecimal(dto.monthlyRent),
        securityDeposit: toDecimal(dto.securityDeposit ?? '0'),
        floor: dto.floor ?? null,
        bedrooms: dto.bedrooms ?? null,
        bathrooms: dto.bathrooms ?? null,
        waterMeterNumber: dto.waterMeterNumber ?? null,
        electricityMeterNumber: dto.electricityMeterNumber ?? null,
        description: dto.description ?? null,
      },
      select: UNIT_SELECT,
    });

    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.UNIT_CREATED,
      entityType: 'Unit',
      entityId: unit.id,
      metadata: {
        unitNumber: unit.unitNumber,
        propertyId: dto.propertyId,
        monthlyRent: serialiseMoney(unit.monthlyRent),
      },
    });

    return this.serialise(unit);
  }

  async update(id: string, dto: UpdateUnitDto) {
    const auth = this.tenant.getOrThrow();
    const current = await this.db.unit.findFirst({
      where: { id, ...this.scope.where() },
      select: { id: true, propertyId: true, buildingId: true, unitNumber: true },
    });
    if (!current) throw new NotFoundError('Unit');

    const nextBuildingId =
      dto.buildingId === undefined ? current.buildingId : (dto.buildingId || null);

    if (nextBuildingId && nextBuildingId !== current.buildingId) {
      const building = await this.db.building.findFirst({
        where: { id: nextBuildingId },
        select: { id: true, propertyId: true },
      });
      if (!building) throw new NotFoundError('Building');
      if (building.propertyId !== current.propertyId) {
        throw new ValidationError('That building belongs to a different property.', [
          { field: 'buildingId', message: 'Choose a building inside this unit\'s property.' },
        ]);
      }
    }

    const nextNumber = dto.unitNumber ?? current.unitNumber;
    if (nextNumber !== current.unitNumber || nextBuildingId !== current.buildingId) {
      await this.assertUnitNumberFree(current.propertyId, nextBuildingId, nextNumber, id);
    }

    const { monthlyRent, securityDeposit, buildingId, ...rest } = dto;

    await this.db.unit.update({
      where: { id },
      data: {
        ...rest,
        ...(buildingId !== undefined ? { buildingId: buildingId || null } : {}),
        ...(monthlyRent !== undefined ? { monthlyRent: toDecimal(monthlyRent) } : {}),
        ...(securityDeposit !== undefined
          ? { securityDeposit: toDecimal(securityDeposit) }
          : {}),
      },
    });

    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.UNIT_UPDATED,
      entityType: 'Unit',
      entityId: id,
      metadata: { changed: Object.keys(dto) },
    });

    return this.findOne(id);
  }

  /**
   * Manual status changes only.
   *
   * OCCUPIED is not in the accepted set: from Phase 3 it is derived from an
   * active lease, and a hand-set value would put the unit table and the lease
   * table into permanent disagreement. Marking an occupied unit vacant is
   * refused for the same reason.
   */
  async setStatus(id: string, dto: UpdateUnitStatusDto) {
    const auth = this.tenant.getOrThrow();
    const unit = await this.db.unit.findFirst({
      where: { id, ...this.scope.where() },
      select: { id: true, status: true, unitNumber: true },
    });
    if (!unit) throw new NotFoundError('Unit');

    if (unit.status === 'OCCUPIED') {
      throw new ConflictError(
        'UNIT_OCCUPIED',
        'This unit is occupied. Its status follows the lease, so end the lease to change it.',
      );
    }

    await this.db.unit.update({ where: { id }, data: { status: dto.status } });

    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.UNIT_STATUS_CHANGED,
      entityType: 'Unit',
      entityId: id,
      metadata: { from: unit.status, to: dto.status, reason: dto.reason ?? null },
    });

    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const auth = this.tenant.getOrThrow();
    const unit = await this.db.unit.findFirst({
      where: { id, ...this.scope.where() },
      select: { id: true, unitNumber: true, status: true },
    });
    if (!unit) throw new NotFoundError('Unit');

    if (unit.status === 'OCCUPIED') {
      throw new ConflictError(
        'UNIT_OCCUPIED',
        'An occupied unit cannot be deleted. End the lease first.',
      );
    }

    /*
     * A vacant unit can still carry a financial history — last year's tenant
     * paid rent against it, and those payments and receipts are accounting
     * records.
     *
     * The database refuses this too (every financial relation is onDelete:
     * Restrict), but a raw foreign-key error tells the user nothing. Counting
     * first turns it into a sentence that names what is in the way.
     */
    const [rentCount, paymentCount, expenseCount] = await Promise.all([
      this.db.rentRecord.count({ where: { unitId: id } }),
      this.db.payment.count({ where: { unitId: id } }),
      this.db.expense.count({ where: { unitId: id } }),
    ]);

    if (rentCount > 0 || paymentCount > 0 || expenseCount > 0) {
      throw new ConflictError(
        'UNIT_HAS_FINANCIAL_HISTORY',
        `This unit has ${rentCount} rent charge(s), ${paymentCount} payment(s) and ` +
          `${expenseCount} expense(s) recorded against it. Financial history is never deleted — ` +
          'mark the unit unavailable instead.',
      );
    }

    await this.db.unit.delete({ where: { id } });

    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.UNIT_DELETED,
      entityType: 'Unit',
      entityId: id,
      metadata: { unitNumber: unit.unitNumber },
    });
  }

  /**
   * The database enforces this too, with two partial unique indexes. Checking
   * here as well turns a raw constraint violation into a field-level message
   * the form can attach to the right input.
   */
  private async assertUnitNumberFree(
    propertyId: string,
    buildingId: string | null,
    unitNumber: string,
    excludeId?: string,
  ): Promise<void> {
    const clash = await this.db.unit.findFirst({
      where: {
        propertyId,
        buildingId,
        unitNumber,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });

    if (clash) {
      throw new ConflictError(
        'UNIT_NUMBER_TAKEN',
        buildingId
          ? 'A unit with that number already exists in this building.'
          : 'A unit with that number already exists in this property.',
        [{ field: 'unitNumber', message: 'This unit number is already in use.' }],
      );
    }
  }
}

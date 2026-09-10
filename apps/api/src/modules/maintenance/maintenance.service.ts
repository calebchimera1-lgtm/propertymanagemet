import { Injectable } from '@nestjs/common';
import type { MaintenanceStatus, Prisma } from '@pm/database';
import { paginated } from '@/common/dto/pagination.dto';
import { ConflictError, NotFoundError, ValidationError } from '@/common/errors/domain.errors';
import { serialiseMoney, toDecimal } from '@/common/money/money';
import { AUDIT_ACTIONS, AuditLogService } from '@/modules/audit-logs/audit-log.service';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { InjectScopedPrisma } from '@/prisma/prisma.module';
import type { ScopedPrismaClient } from '@/prisma/tenant-scope.extension';
import { PropertyScopeService } from '@/tenancy/property-scope.service';
import { TenantContextService } from '@/tenancy/tenant-context.service';
import type {
  AddMaintenanceUpdateDto,
  AssignMaintenanceDto,
  ChangeMaintenanceStatusDto,
  CreateMaintenanceDto,
  ListMaintenanceQueryDto,
  UpdateMaintenanceDto,
} from './dto/maintenance.dto';
import { canTransition, transitionRefusal } from './maintenance-status';

const REQUEST_SELECT = {
  id: true,
  propertyId: true,
  buildingId: true,
  unitId: true,
  tenantId: true,
  title: true,
  description: true,
  priority: true,
  status: true,
  assignedToId: true,
  estimatedCost: true,
  actualCost: true,
  reportedById: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  property: { select: { id: true, name: true } },
  building: { select: { id: true, name: true } },
  unit: { select: { id: true, unitNumber: true } },
  tenant: { select: { id: true, fullName: true, phone: true } },
  assignedTo: { select: { id: true, fullName: true, email: true } },
  reportedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.MaintenanceRequestSelect;

type RequestRow = Prisma.MaintenanceRequestGetPayload<{ select: typeof REQUEST_SELECT }>;

/**
 * Maintenance requests: the work that keeps a property running.
 *
 * Two things this service is careful about:
 *
 *   1. **Every status change writes a timeline row.** The history of a job is a
 *      table of MaintenanceUpdate rows, not a column that only remembers its
 *      latest value — so "who marked this done, and when" always has an answer.
 *   2. **Transitions are validated against a table**, not against whatever the
 *      client sent. A request cannot jump from PENDING to COMPLETED, and a
 *      finished job cannot be quietly reopened.
 */
@Injectable()
export class MaintenanceService {
  constructor(
    @InjectScopedPrisma() private readonly db: ScopedPrismaClient,
    private readonly scope: PropertyScopeService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditLogService,
    private readonly notifications: NotificationsService,
  ) {}

  private serialise(request: RequestRow) {
    return {
      ...request,
      estimatedCost: request.estimatedCost ? serialiseMoney(request.estimatedCost) : null,
      actualCost: request.actualCost ? serialiseMoney(request.actualCost) : null,
    };
  }

  /**
   * Resolves the assignee, refusing anyone outside the organization.
   *
   * Deliberately does NOT require the assignee to hold a maintenance
   * permission: assigning a job to a caretaker who currently cannot open the
   * app is a real situation (they are being onboarded), and blocking it would
   * push people to leave jobs unassigned instead.
   */
  private async assertAssignee(assignedToId: string): Promise<void> {
    const user = await this.db.user.findFirst({
      where: { id: assignedToId },
      select: { id: true },
    });
    if (!user) {
      throw new ValidationError('That person is not in your organization.', [
        { field: 'assignedToId', message: 'Choose a member of your staff.' },
      ]);
    }
  }

  private async assertPlacement(dto: {
    propertyId: string;
    buildingId?: string;
    unitId?: string;
    tenantId?: string;
  }): Promise<void> {
    this.scope.assertProperty(dto.propertyId, 'Property');

    /*
     * Existence, not just scope.
     *
     * assertProperty only narrows a property-scoped user; an unrestricted owner
     * passes it with any id at all, and the composite foreign key would then
     * refuse the insert as a 409 "that would break a link" — technically safe,
     * but it names a constraint rather than saying the property is not theirs.
     * Reading through the scoped client turns it into the same 404 every other
     * cross-organization reference gets.
     */
    const property = await this.db.property.count({ where: { id: dto.propertyId } });
    if (property === 0) throw new NotFoundError('Property');

    if (dto.buildingId) {
      const building = await this.db.building.findFirst({
        where: { id: dto.buildingId, propertyId: dto.propertyId },
        select: { id: true },
      });
      if (!building) throw new NotFoundError('Building');
    }
    if (dto.unitId) {
      const unit = await this.db.unit.findFirst({
        where: { id: dto.unitId, propertyId: dto.propertyId },
        select: { id: true },
      });
      if (!unit) throw new NotFoundError('Unit');
    }
    if (dto.tenantId) {
      const tenant = await this.db.tenant.findFirst({
        where: { id: dto.tenantId },
        select: { id: true },
      });
      if (!tenant) throw new NotFoundError('Tenant');
    }
  }

  async list(query: ListMaintenanceQueryDto) {
    const auth = this.tenant.getOrThrow();
    if (query.propertyId) this.scope.assertProperty(query.propertyId, 'Maintenance request');

    const assignedToId = query.assignedToId === 'me' ? auth.userId : query.assignedToId;

    const where: Prisma.MaintenanceRequestWhereInput = {
      ...this.scope.where(),
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.propertyId ? { propertyId: query.propertyId } : {}),
      ...(query.unitId ? { unitId: query.unitId } : {}),
      ...(query.tenantId ? { tenantId: query.tenantId } : {}),
      ...(assignedToId ? { assignedToId } : {}),
      ...(query.openOnly === 'true'
        ? { status: { notIn: ['COMPLETED', 'CANCELLED'] } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total, openCount] = await Promise.all([
      this.db.maintenanceRequest.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder },
        select: REQUEST_SELECT,
      }),
      this.db.maintenanceRequest.count({ where }),
      this.db.maintenanceRequest.count({
        where: { ...this.scope.where(), status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      }),
    ]);

    return {
      ...paginated(rows.map((row) => this.serialise(row)), total, query.page, query.limit),
      /** Open jobs across the whole scope, not just this filter — the badge number. */
      openCount,
    };
  }

  /** Counts by status, for the board columns. */
  async summary() {
    const grouped = await this.db.maintenanceRequest.groupBy({
      by: ['status'],
      where: this.scope.where(),
      _count: { _all: true },
    });

    const counts: Record<string, number> = {};
    for (const row of grouped) counts[row.status] = row._count._all;

    const urgentOpen = await this.db.maintenanceRequest.count({
      where: {
        ...this.scope.where(),
        priority: 'URGENT',
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
    });

    return { counts, urgentOpen };
  }

  async findOne(id: string) {
    const request = await this.db.maintenanceRequest.findFirst({
      where: { id, ...this.scope.where() },
      select: REQUEST_SELECT,
    });
    if (!request) throw new NotFoundError('Maintenance request');

    const updates = await this.db.maintenanceUpdate.findMany({
      where: { maintenanceRequestId: id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        note: true,
        fromStatus: true,
        toStatus: true,
        createdAt: true,
        author: { select: { id: true, fullName: true } },
      },
    });

    return { ...this.serialise(request), updates };
  }

  async create(dto: CreateMaintenanceDto) {
    const auth = this.tenant.getOrThrow();
    await this.assertPlacement(dto);
    if (dto.assignedToId) await this.assertAssignee(dto.assignedToId);

    const request = await this.db.maintenanceRequest.create({
      data: {
        organizationId: auth.organizationId,
        propertyId: dto.propertyId,
        buildingId: dto.buildingId ?? null,
        unitId: dto.unitId ?? null,
        tenantId: dto.tenantId ?? null,
        title: dto.title,
        description: dto.description,
        priority: dto.priority ?? 'MEDIUM',
        // Assigning at creation moves it straight past PENDING — the job has
        // an owner, so saying it is unassigned would be false.
        status: dto.assignedToId ? 'ASSIGNED' : 'PENDING',
        assignedToId: dto.assignedToId ?? null,
        estimatedCost: dto.estimatedCost ? toDecimal(dto.estimatedCost) : null,
        reportedById: auth.userId,
      },
      select: REQUEST_SELECT,
    });

    await this.db.maintenanceUpdate.create({
      data: {
        organizationId: auth.organizationId,
        maintenanceRequestId: request.id,
        authorId: auth.userId,
        note: 'Request raised.',
        toStatus: request.status,
      },
    });

    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.MAINTENANCE_CREATED,
      entityType: 'MaintenanceRequest',
      entityId: request.id,
      metadata: { title: request.title, priority: request.priority },
    });

    if (request.assignedToId) {
      await this.notifications.maintenanceAssigned(request.assignedToId, request.id, request.title);
    }

    return this.findOne(request.id);
  }

  async update(id: string, dto: UpdateMaintenanceDto) {
    const auth = this.tenant.getOrThrow();
    const existing = await this.db.maintenanceRequest.findFirst({
      where: { id, ...this.scope.where() },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundError('Maintenance request');

    if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED') {
      throw new ConflictError(
        'MAINTENANCE_CLOSED',
        `A ${existing.status.toLowerCase()} request cannot be edited. Raise a new request instead.`,
      );
    }

    await this.db.maintenanceRequest.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        ...(dto.estimatedCost !== undefined
          ? { estimatedCost: toDecimal(dto.estimatedCost) }
          : {}),
        ...(dto.actualCost !== undefined ? { actualCost: toDecimal(dto.actualCost) } : {}),
      },
    });

    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.MAINTENANCE_UPDATED,
      entityType: 'MaintenanceRequest',
      entityId: id,
      metadata: { changed: Object.keys(dto) },
    });

    return this.findOne(id);
  }

  async assign(id: string, dto: AssignMaintenanceDto) {
    const auth = this.tenant.getOrThrow();
    const existing = await this.db.maintenanceRequest.findFirst({
      where: { id, ...this.scope.where() },
      select: { id: true, status: true, assignedToId: true, title: true },
    });
    if (!existing) throw new NotFoundError('Maintenance request');

    if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED') {
      throw new ConflictError(
        'MAINTENANCE_CLOSED',
        `A ${existing.status.toLowerCase()} request cannot be reassigned.`,
      );
    }

    const assignedToId = dto.assignedToId ?? null;
    if (assignedToId) await this.assertAssignee(assignedToId);

    /*
     * Assignment moves the status, but only from the states where that makes
     * sense. A job already IN_PROGRESS stays in progress when the person
     * changes — the work did not stop because the owner did.
     */
    let status = existing.status;
    if (assignedToId && existing.status === 'PENDING') status = 'ASSIGNED';
    if (!assignedToId && existing.status === 'ASSIGNED') status = 'PENDING';

    const assignee = assignedToId
      ? await this.db.user.findFirst({ where: { id: assignedToId }, select: { fullName: true } })
      : null;

    await this.db.$transaction([
      this.db.maintenanceRequest.update({ where: { id }, data: { assignedToId, status } }),
      this.db.maintenanceUpdate.create({
        data: {
          organizationId: auth.organizationId,
          maintenanceRequestId: id,
          authorId: auth.userId,
          note:
            dto.note ??
            (assignee ? `Assigned to ${assignee.fullName}.` : 'Assignment cleared.'),
          fromStatus: existing.status,
          toStatus: status,
        },
      }),
    ]);

    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.MAINTENANCE_ASSIGNED,
      entityType: 'MaintenanceRequest',
      entityId: id,
      metadata: { assignedToId, previousAssigneeId: existing.assignedToId },
    });

    if (assignedToId && assignedToId !== existing.assignedToId) {
      await this.notifications.maintenanceAssigned(assignedToId, id, existing.title);
    }

    return this.findOne(id);
  }

  async changeStatus(id: string, dto: ChangeMaintenanceStatusDto) {
    const auth = this.tenant.getOrThrow();
    const existing = await this.db.maintenanceRequest.findFirst({
      where: { id, ...this.scope.where() },
      select: { id: true, status: true, title: true, assignedToId: true, reportedById: true },
    });
    if (!existing) throw new NotFoundError('Maintenance request');

    const to = dto.status as MaintenanceStatus;
    if (!canTransition(existing.status, to)) {
      throw new ConflictError(
        'MAINTENANCE_INVALID_TRANSITION',
        transitionRefusal(existing.status, to),
      );
    }

    // completedAt and COMPLETED must agree — the database enforces this too.
    const completedAt = to === 'COMPLETED' ? new Date() : null;

    await this.db.$transaction([
      this.db.maintenanceRequest.update({
        where: { id },
        data: {
          status: to,
          completedAt,
          ...(dto.actualCost !== undefined ? { actualCost: toDecimal(dto.actualCost) } : {}),
        },
      }),
      this.db.maintenanceUpdate.create({
        data: {
          organizationId: auth.organizationId,
          maintenanceRequestId: id,
          authorId: auth.userId,
          note: dto.note ?? `Status changed to ${to.toLowerCase().replace('_', ' ')}.`,
          fromStatus: existing.status,
          toStatus: to,
        },
      }),
    ]);

    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.MAINTENANCE_STATUS_CHANGED,
      entityType: 'MaintenanceRequest',
      entityId: id,
      metadata: { from: existing.status, to, actualCost: dto.actualCost ?? null },
    });

    // Tell the people who care: whoever raised it, and whoever owns it.
    const recipients = [existing.reportedById, existing.assignedToId].filter(
      (userId): userId is string => Boolean(userId) && userId !== auth.userId,
    );
    await this.notifications.maintenanceStatusChanged(recipients, id, existing.title, to);

    return this.findOne(id);
  }

  async addUpdate(id: string, dto: AddMaintenanceUpdateDto) {
    const auth = this.tenant.getOrThrow();
    const existing = await this.db.maintenanceRequest.findFirst({
      where: { id, ...this.scope.where() },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError('Maintenance request');

    await this.db.maintenanceUpdate.create({
      data: {
        organizationId: auth.organizationId,
        maintenanceRequestId: id,
        authorId: auth.userId,
        note: dto.note,
      },
    });

    return this.findOne(id);
  }

  async listUpdates(id: string) {
    // findOne applies the scope check, so this cannot read another
    // organization's timeline by guessing an id.
    const request = await this.findOne(id);
    return request.updates;
  }
}

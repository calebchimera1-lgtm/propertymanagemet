import { Injectable, Logger } from '@nestjs/common';
import type { MaintenanceStatus, NotificationType, Prisma } from '@pm/database';
import { paginated } from '@/common/dto/pagination.dto';
import { NotFoundError } from '@/common/errors/domain.errors';
import { PrismaService } from '@/prisma/prisma.service';
import { TenantContextService } from '@/tenancy/tenant-context.service';
import type { ListNotificationsQueryDto } from './dto/notification.dto';
import { NotificationRecipientsService } from './notification-recipients.service';

interface NotificationInput {
  organizationId: string;
  userIds: string[];
  type: NotificationType;
  title: string;
  body: string;
  entityType?: string;
  entityId?: string;
  /**
   * The fact being reported, not its wording. Two sweeps on the same day about
   * the same charge produce the same key and collapse to one row — enforced by
   * a partial unique index, so it holds even if two workers race.
   */
  dedupeKey?: string;
}

/**
 * In-app notifications.
 *
 * V1 is in-app only. The email, SMS and WhatsApp ports exist and are injected,
 * but their V1 adapters do not send: nothing in this product tells a user that
 * a message went out when it did not.
 *
 * Writing a notification must never break the thing that caused it. A failed
 * insert is logged and swallowed, exactly like the audit trail — recording a
 * payment must not fail because an alert could not be written.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly recipients: NotificationRecipientsService,
  ) {}

  /**
   * The organization's display currency, for an alert body.
   *
   * Looked up here rather than carried on the session: the session is an
   * authorization context, and widening it with presentation data is how it
   * ends up carrying things that should not be in a cookie-backed store.
   */
  private async currencyOf(organizationId: string): Promise<string> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { currency: true },
    });
    return organization?.currency ?? 'KES';
  }

  /** Today at UTC midnight, as a date stamp for dedupe keys. */
  private static dayStamp(date = new Date()): string {
    return date.toISOString().slice(0, 10);
  }

  async notify(input: NotificationInput): Promise<number> {
    const userIds = [...new Set(input.userIds)].filter(Boolean);
    if (userIds.length === 0) return 0;

    try {
      const result = await this.prisma.notification.createMany({
        data: userIds.map((userId) => ({
          organizationId: input.organizationId,
          userId,
          type: input.type,
          title: input.title,
          body: input.body,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          dedupeKey: input.dedupeKey ?? null,
        })),
        // The partial unique index does the work; this makes a re-run a no-op
        // rather than an error the caller has to catch.
        skipDuplicates: true,
      });
      return result.count;
    } catch (error) {
      this.logger.error(`Could not write notifications: ${(error as Error).message}`);
      return 0;
    }
  }

  // ── Domain events ──────────────────────────────────────────────────────────

  async maintenanceAssigned(userId: string, requestId: string, title: string): Promise<void> {
    const auth = this.tenant.getOrThrow();
    await this.notify({
      organizationId: auth.organizationId,
      userIds: [userId],
      type: 'MAINTENANCE_UPDATED',
      title: 'A maintenance job was assigned to you',
      body: title,
      entityType: 'MaintenanceRequest',
      entityId: requestId,
      // Reassigning back and forth on the same day should not spam.
      dedupeKey: `MAINTENANCE_ASSIGNED:${requestId}:${userId}:${NotificationsService.dayStamp()}`,
    });
  }

  async maintenanceStatusChanged(
    userIds: string[],
    requestId: string,
    title: string,
    status: MaintenanceStatus,
  ): Promise<void> {
    if (userIds.length === 0) return;
    const auth = this.tenant.getOrThrow();
    await this.notify({
      organizationId: auth.organizationId,
      userIds,
      type: 'MAINTENANCE_UPDATED',
      title: `Maintenance ${status.toLowerCase().replace('_', ' ')}`,
      body: title,
      entityType: 'MaintenanceRequest',
      entityId: requestId,
      dedupeKey: `MAINTENANCE_STATUS:${requestId}:${status}:${NotificationsService.dayStamp()}`,
    });
  }

  /**
   * A payment was recorded. Goes to everyone who may see money on that
   * property — never to a caretaker, who cannot.
   */
  async paymentRecorded(input: {
    organizationId: string;
    propertyId: string;
    paymentId: string;
    tenantName: string;
    amount: string;
    excludeUserId?: string;
  }): Promise<void> {
    const userIds = (
      await this.recipients.forPermission(input.organizationId, 'payments.view', input.propertyId)
    ).filter((userId) => userId !== input.excludeUserId);

    const currency = await this.currencyOf(input.organizationId);

    await this.notify({
      organizationId: input.organizationId,
      userIds,
      type: 'PAYMENT_RECORDED',
      title: 'Payment recorded',
      body: `${input.tenantName} paid ${currency} ${input.amount}.`,
      entityType: 'Payment',
      entityId: input.paymentId,
      dedupeKey: `PAYMENT_RECORDED:${input.paymentId}`,
    });
  }

  async rentOverdue(input: {
    organizationId: string;
    propertyId: string;
    rentRecordId: string;
    tenantName: string;
    unitNumber: string;
    balance: string;
    currency: string;
    day?: string;
  }): Promise<number> {
    const userIds = await this.recipients.forPermission(
      input.organizationId,
      'rent.view',
      input.propertyId,
    );
    return this.notify({
      organizationId: input.organizationId,
      userIds,
      type: 'RENT_OVERDUE',
      title: 'Rent is overdue',
      body: `${input.tenantName} (unit ${input.unitNumber}) owes ${input.currency} ${input.balance}.`,
      entityType: 'RentRecord',
      entityId: input.rentRecordId,
      dedupeKey: `RENT_OVERDUE:${input.rentRecordId}:${input.day ?? NotificationsService.dayStamp()}`,
    });
  }

  async leaseExpiring(input: {
    organizationId: string;
    propertyId: string;
    leaseId: string;
    tenantName: string;
    unitNumber: string;
    daysUntil: number;
    day?: string;
  }): Promise<number> {
    const userIds = await this.recipients.forPermission(
      input.organizationId,
      'leases.view',
      input.propertyId,
    );
    return this.notify({
      organizationId: input.organizationId,
      userIds,
      type: 'LEASE_EXPIRING',
      title: `Lease expires in ${input.daysUntil} day${input.daysUntil === 1 ? '' : 's'}`,
      body: `${input.tenantName}, unit ${input.unitNumber}.`,
      entityType: 'Lease',
      entityId: input.leaseId,
      // Keyed on the milestone, so 60/30/7 each land once and never repeat.
      dedupeKey: `LEASE_EXPIRING:${input.leaseId}:${input.daysUntil}`,
    });
  }

  async maintenanceStale(input: {
    organizationId: string;
    propertyId: string;
    requestId: string;
    title: string;
    hoursOpen: number;
    day?: string;
  }): Promise<number> {
    const userIds = await this.recipients.forPermission(
      input.organizationId,
      'maintenance.update',
      input.propertyId,
    );
    return this.notify({
      organizationId: input.organizationId,
      userIds,
      type: 'MAINTENANCE_UPDATED',
      title: 'Urgent maintenance still open',
      body: `${input.title} — open for ${input.hoursOpen} hours.`,
      entityType: 'MaintenanceRequest',
      entityId: input.requestId,
      dedupeKey: `MAINTENANCE_STALE:${input.requestId}:${input.day ?? NotificationsService.dayStamp()}`,
    });
  }

  // ── Reads and marks, always for the calling user only ──────────────────────

  private ownWhere(): Prisma.NotificationWhereInput {
    const auth = this.tenant.getOrThrow();
    // Both columns, deliberately. userId alone would be enough today because
    // ids are unique, but organizationId keeps the row in the tenant's lane if
    // an id ever collides or a user is ever moved.
    return { userId: auth.userId, organizationId: auth.organizationId };
  }

  async list(query: ListNotificationsQueryDto) {
    const where: Prisma.NotificationWhereInput = {
      ...this.ownWhere(),
      ...(query.unreadOnly === 'true' ? { readAt: null } : {}),
      ...(query.type ? { type: query.type } : {}),
    };

    const [rows, total, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          entityType: true,
          entityId: true,
          readAt: true,
          createdAt: true,
        },
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { ...this.ownWhere(), readAt: null } }),
    ]);

    return { ...paginated(rows, total, query.page, query.limit), unreadCount: unread };
  }

  async unreadCount(): Promise<{ count: number }> {
    const count = await this.prisma.notification.count({
      where: { ...this.ownWhere(), readAt: null },
    });
    return { count };
  }

  async markRead(id: string) {
    // updateMany with the ownership filter, not update-by-id: a by-id update
    // would touch another user's row before the check could stop it.
    const result = await this.prisma.notification.updateMany({
      where: { id, ...this.ownWhere(), readAt: null },
      data: { readAt: new Date() },
    });

    if (result.count === 0) {
      const exists = await this.prisma.notification.count({ where: { id, ...this.ownWhere() } });
      if (exists === 0) throw new NotFoundError('Notification');
    }
    return this.unreadCount();
  }

  async markAllRead() {
    const result = await this.prisma.notification.updateMany({
      where: { ...this.ownWhere(), readAt: null },
      data: { readAt: new Date() },
    });
    return { marked: result.count, count: 0 };
  }
}

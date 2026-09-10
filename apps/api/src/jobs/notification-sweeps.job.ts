import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { serialiseMoney } from '@/common/money/money';
import { todayUtc } from '@/modules/leases/lease-dates';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { PrismaService } from '@/prisma/prisma.service';

/** The lease-expiry milestones people actually act on. */
const EXPIRY_MILESTONES = [60, 30, 7];

/** How long an URGENT job may sit untouched before it is chased. */
const STALE_URGENT_HOURS = 48;

/**
 * The daily sweeps that turn stored facts into alerts.
 *
 * Every one of these is idempotent: the notification dedupe key names the fact
 * and the day, and a partial unique index enforces it — so a re-run, a restart
 * mid-sweep, or two workers racing all produce one alert, not three.
 *
 * They run against the unscoped client with an explicit organizationId, because
 * a scheduled job has no request and therefore no tenant context. Recipient
 * resolution still applies the permission matrix and property scope, so a
 * caretaker never receives a rent figure they are not allowed to see.
 */
@Injectable()
export class NotificationSweepsJob {
  private readonly logger = new Logger(NotificationSweepsJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private async activeOrganizations() {
    return this.prisma.organization.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, currency: true },
    });
  }

  @Cron('0 6 * * *', { name: 'rent-overdue-sweep' })
  async rentOverdue(): Promise<number> {
    const day = todayUtc().toISOString().slice(0, 10);
    let sent = 0;

    for (const organization of await this.activeOrganizations()) {
      const overdue = await this.prisma.rentRecord.findMany({
        where: { organizationId: organization.id, status: 'OVERDUE', balance: { gt: 0 } },
        select: {
          id: true,
          propertyId: true,
          balance: true,
          tenant: { select: { fullName: true } },
          unit: { select: { unitNumber: true } },
        },
        // A cap, not a page: an organization with 500 overdue charges needs a
        // report, not 500 notifications. The rent screen is the report.
        take: 100,
      });

      for (const record of overdue) {
        sent += await this.notifications.rentOverdue({
          organizationId: organization.id,
          propertyId: record.propertyId,
          rentRecordId: record.id,
          tenantName: record.tenant.fullName,
          unitNumber: record.unit.unitNumber,
          balance: serialiseMoney(record.balance),
          currency: organization.currency,
          day,
        });
      }
    }

    if (sent > 0) this.logger.log(`Rent overdue sweep sent ${sent} notification(s)`);
    return sent;
  }

  @Cron('15 6 * * *', { name: 'lease-expiring-sweep' })
  async leaseExpiring(): Promise<number> {
    const today = todayUtc();
    let sent = 0;

    for (const organization of await this.activeOrganizations()) {
      for (const days of EXPIRY_MILESTONES) {
        // Exactly that day, not "within" it — otherwise the 60-day milestone
        // fires again at 59, 58, 57 with a different dedupe key each time.
        const target = new Date(today.getTime() + days * 86_400_000);

        const leases = await this.prisma.lease.findMany({
          where: {
            organizationId: organization.id,
            status: { in: ['ACTIVE', 'EXPIRING_SOON'] },
            endDate: target,
          },
          select: {
            id: true,
            propertyId: true,
            tenant: { select: { fullName: true } },
            unit: { select: { unitNumber: true } },
          },
          take: 100,
        });

        for (const lease of leases) {
          sent += await this.notifications.leaseExpiring({
            organizationId: organization.id,
            propertyId: lease.propertyId,
            leaseId: lease.id,
            tenantName: lease.tenant.fullName,
            unitNumber: lease.unit.unitNumber,
            daysUntil: days,
          });
        }
      }
    }

    if (sent > 0) this.logger.log(`Lease expiry sweep sent ${sent} notification(s)`);
    return sent;
  }

  @Cron('30 6 * * *', { name: 'stale-maintenance-sweep' })
  async staleMaintenance(): Promise<number> {
    const cutoff = new Date(Date.now() - STALE_URGENT_HOURS * 3_600_000);
    const day = todayUtc().toISOString().slice(0, 10);
    let sent = 0;

    for (const organization of await this.activeOrganizations()) {
      const stale = await this.prisma.maintenanceRequest.findMany({
        where: {
          organizationId: organization.id,
          priority: 'URGENT',
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
          createdAt: { lt: cutoff },
        },
        select: { id: true, propertyId: true, title: true, createdAt: true },
        take: 100,
      });

      for (const request of stale) {
        sent += await this.notifications.maintenanceStale({
          organizationId: organization.id,
          propertyId: request.propertyId,
          requestId: request.id,
          title: request.title,
          hoursOpen: Math.floor((Date.now() - request.createdAt.getTime()) / 3_600_000),
          day,
        });
      }
    }

    if (sent > 0) this.logger.log(`Stale maintenance sweep sent ${sent} notification(s)`);
    return sent;
  }
}

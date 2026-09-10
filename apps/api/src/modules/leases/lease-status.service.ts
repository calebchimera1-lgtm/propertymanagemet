import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { addDays, todayUtc } from './lease-dates';

export interface DerivationResult {
  expiringSoon: number;
  expired: number;
}

/**
 * Derives EXPIRING_SOON and EXPIRED from the calendar.
 *
 * Neither status is ever set by hand: two sources of truth for "has this lease
 * ended" is how a renewals list starts lying. The warning window is per
 * organization (Settings.leaseExpiryWarningDays).
 *
 * Runs outside a request, so it uses the unscoped client — organization by
 * organization, explicitly, rather than across all of them at once.
 */
@Injectable()
export class LeaseStatusService {
  private readonly logger = new Logger(LeaseStatusService.name);

  constructor(private readonly prisma: PrismaService) {}

  async deriveAll(): Promise<DerivationResult> {
    const organizations = await this.prisma.organization.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, settings: { select: { leaseExpiryWarningDays: true } } },
    });

    const totals: DerivationResult = { expiringSoon: 0, expired: 0 };

    for (const organization of organizations) {
      const result = await this.deriveFor(
        organization.id,
        organization.settings?.leaseExpiryWarningDays ?? 60,
      );
      totals.expiringSoon += result.expiringSoon;
      totals.expired += result.expired;
    }

    return totals;
  }

  async deriveFor(organizationId: string, warningDays: number): Promise<DerivationResult> {
    const today = todayUtc();
    const warningEdge = addDays(today, warningDays);

    // Order matters: mark what has passed first, so a lease that expired today
    // is not first flagged as "expiring soon" and then immediately corrected.
    const expired = await this.prisma.lease.updateMany({
      where: {
        organizationId,
        status: { in: ['ACTIVE', 'EXPIRING_SOON'] },
        endDate: { not: null, lt: today },
      },
      data: { status: 'EXPIRED' },
    });

    const expiringSoon = await this.prisma.lease.updateMany({
      where: {
        organizationId,
        status: 'ACTIVE',
        endDate: { not: null, gte: today, lte: warningEdge },
      },
      data: { status: 'EXPIRING_SOON' },
    });

    // A renewal pushes the end date beyond the window; put it back to ACTIVE so
    // the worklist does not keep showing a lease somebody already dealt with.
    const backToActive = await this.prisma.lease.updateMany({
      where: {
        organizationId,
        status: 'EXPIRING_SOON',
        endDate: { not: null, gt: warningEdge },
      },
      data: { status: 'ACTIVE' },
    });

    if (expired.count || expiringSoon.count || backToActive.count) {
      this.logger.log(
        `Organization ${organizationId}: ${expired.count} expired, ` +
          `${expiringSoon.count} expiring soon, ${backToActive.count} back to active`,
      );
    }

    return { expiringSoon: expiringSoon.count, expired: expired.count };
  }
}

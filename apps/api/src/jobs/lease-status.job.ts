import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LeaseStatusService } from '@/modules/leases/lease-status.service';

/**
 * Keeps lease statuses in step with the calendar.
 *
 * Runs early, before anyone opens the renewals list for the day. It is
 * idempotent: running it twice changes nothing the second time, so a missed
 * night is corrected by the next run rather than needing a backfill.
 */
@Injectable()
export class LeaseStatusJob {
  private readonly logger = new Logger(LeaseStatusJob.name);

  constructor(private readonly leaseStatus: LeaseStatusService) {}

  @Cron(CronExpression.EVERY_DAY_AT_1AM, { name: 'derive-lease-statuses' })
  async derive(): Promise<void> {
    const result = await this.leaseStatus.deriveAll();
    if (result.expired || result.expiringSoon) {
      this.logger.log(
        `Lease statuses derived: ${result.expired} expired, ${result.expiringSoon} expiring soon`,
      );
    }
  }
}

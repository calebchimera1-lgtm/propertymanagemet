import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SessionService } from '@/modules/auth/session.service';

/**
 * Housekeeping only. Sessions stop working the moment they expire; this simply
 * stops the table growing forever.
 *
 * Runs outside any request, so it uses the unscoped client by way of
 * SessionService — which is exactly why that client exists.
 */
@Injectable()
export class SessionCleanupJob {
  private readonly logger = new Logger(SessionCleanupJob.name);

  constructor(private readonly sessions: SessionService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'purge-expired-sessions' })
  async purge(): Promise<void> {
    const removed = await this.sessions.purgeExpired();
    if (removed > 0) this.logger.log(`Purged ${removed} long-expired session(s)`);
  }
}

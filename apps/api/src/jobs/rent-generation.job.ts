import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RentGenerationService } from '@/modules/rent/rent-generation.service';

/**
 * Bills the month, then marks what is late.
 *
 * Runs nightly rather than monthly on purpose: a lease created on the 12th
 * needs its charge for the month it started, and a nightly idempotent pass
 * picks that up without anybody remembering to press a button. Running every
 * night costs one no-op query per organization.
 */
@Injectable()
export class RentGenerationJob {
  private readonly logger = new Logger(RentGenerationJob.name);

  constructor(private readonly generation: RentGenerationService) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM, { name: 'generate-monthly-rent' })
  async run(): Promise<void> {
    const results = await this.generation.generateForAll();
    const created = results.reduce((total, result) => total + result.created, 0);
    if (created > 0) {
      this.logger.log(`Generated ${created} rent record(s) across ${results.length} organization(s)`);
    }

    await this.generation.markOverdue();
  }
}

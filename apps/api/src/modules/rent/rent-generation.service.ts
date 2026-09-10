import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@pm/database';
import { todayUtc } from '@/modules/leases/lease-dates';
import { PrismaService } from '@/prisma/prisma.service';
import { type RentPeriod, currentPeriod, dueDateFor, leaseCoversPeriod } from './rent-period';

export interface GenerationResult {
  periodLabel: string;
  created: number;
  skipped: number;
  /** Leases not billed because their agreement has lapsed. */
  expiredLeasesSkipped: number;
}

/**
 * Turns active leases into monthly rent charges.
 *
 * Idempotent by construction: `UNIQUE (leaseId, periodStart)` plus
 * `skipDuplicates` means a cron re-run, a double-clicked button and a container
 * restart mid-job all collapse into the same single row. Nothing here needs to
 * know whether it has run before.
 *
 * Runs both from a scheduled job (no request context) and from an authenticated
 * endpoint, so it takes an explicit organizationId and uses the unscoped client.
 */
@Injectable()
export class RentGenerationService {
  private readonly logger = new Logger(RentGenerationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * @param propertyIds Restricts generation to these properties. `null` means
   * unrestricted — what the scheduled job and an owner both pass. A scoped
   * accountant passes their assigned ids, so pressing "generate" cannot create
   * charges, or report counts, for a property they cannot open.
   */
  async generateForOrganization(
    organizationId: string,
    period: RentPeriod = currentPeriod(),
    propertyIds: string[] | null = null,
  ): Promise<GenerationResult> {
    const scope = propertyIds === null ? {} : { propertyId: { in: propertyIds } };
    /*
     * Only live leases are billed.
     *
     * An EXPIRED lease is deliberately excluded: charging rent under an
     * agreement that has lapsed is a decision for a person, not a nightly job.
     * Those leases sit on the renewals worklist until someone renews or ends
     * them, and the count is reported back so the omission is visible rather
     * than silent.
     */
    const leases = await this.prisma.lease.findMany({
      where: { organizationId, ...scope, status: { in: ['ACTIVE', 'EXPIRING_SOON'] } },
      select: {
        id: true,
        tenantId: true,
        propertyId: true,
        buildingId: true,
        unitId: true,
        startDate: true,
        endDate: true,
        monthlyRent: true,
        dueDay: true,
      },
    });

    const expiredLeasesSkipped = await this.prisma.lease.count({
      where: { organizationId, ...scope, status: 'EXPIRED' },
    });

    const billable = leases.filter((lease) => leaseCoversPeriod(lease, period));

    const rows: Prisma.RentRecordCreateManyInput[] = billable.map((lease) => ({
      organizationId,
      leaseId: lease.id,
      tenantId: lease.tenantId,
      propertyId: lease.propertyId,
      buildingId: lease.buildingId,
      unitId: lease.unitId,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      periodLabel: period.periodLabel,
      // Copied from the lease at generation. A later rent review must not
      // rewrite what earlier months were billed at.
      expectedAmount: lease.monthlyRent,
      paidAmount: '0',
      balance: lease.monthlyRent,
      dueDate: dueDateFor(period, lease.dueDay),
      status: 'PENDING',
    }));

    const result =
      rows.length > 0
        ? await this.prisma.rentRecord.createMany({ data: rows, skipDuplicates: true })
        : { count: 0 };

    if (result.count > 0) {
      this.logger.log(
        `Generated ${result.count} rent record(s) for ${organizationId} in ${period.periodLabel}`,
      );
    }

    return {
      periodLabel: period.periodLabel,
      created: result.count,
      skipped: rows.length - result.count,
      expiredLeasesSkipped,
    };
  }

  async generateForAll(period: RentPeriod = currentPeriod()): Promise<GenerationResult[]> {
    const organizations = await this.prisma.organization.findMany({
      where: { status: 'ACTIVE', settings: { rentGenerationEnabled: true } },
      select: { id: true },
    });

    const results: GenerationResult[] = [];
    for (const organization of organizations) {
      results.push(await this.generateForOrganization(organization.id, period));
    }
    return results;
  }

  /**
   * Moves unpaid records past their due date to OVERDUE.
   *
   * Separate from generation and equally idempotent: a record that is already
   * OVERDUE is not matched, so running twice changes nothing the second time.
   * PAID records are never touched — a paid charge cannot become late.
   */
  async markOverdue(organizationId?: string): Promise<number> {
    const result = await this.prisma.rentRecord.updateMany({
      where: {
        ...(organizationId ? { organizationId } : {}),
        status: { in: ['PENDING', 'PARTIALLY_PAID'] },
        dueDate: { lt: todayUtc() },
        balance: { gt: 0 },
      },
      data: { status: 'OVERDUE' },
    });

    if (result.count > 0) {
      this.logger.log(`Marked ${result.count} rent record(s) overdue`);
    }
    return result.count;
  }
}

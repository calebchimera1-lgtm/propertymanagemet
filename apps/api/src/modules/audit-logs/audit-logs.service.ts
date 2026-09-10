import { Injectable } from '@nestjs/common';
import type { Prisma } from '@pm/database';
import { paginated } from '@/common/dto/pagination.dto';
import { parseDateOnly } from '@/modules/leases/lease-dates';
import { InjectScopedPrisma } from '@/prisma/prisma.module';
import type { ScopedPrismaClient } from '@/prisma/tenant-scope.extension';
import type { ListAuditLogsQueryDto } from './dto/audit-log.dto';

/**
 * Reading the audit trail.
 *
 * Read-only by design: there is no create, update or delete endpoint anywhere
 * in the application, because a trail an operator can edit is not a trail. Rows
 * are written by AuditLogService as a side effect of the actions they describe.
 *
 * Note the missing fields in the select. `metadata` is returned because it is
 * what makes an entry useful, and it is already filtered against a denylist on
 * the way in — but `ipAddress` and `userAgent` are not, because a staff list
 * showing colleagues' IP addresses is surveillance rather than an audit trail.
 * They stay in the database for an incident investigation.
 */
@Injectable()
export class AuditLogsService {
  constructor(@InjectScopedPrisma() private readonly db: ScopedPrismaClient) {}

  async list(query: ListAuditLogsQueryDto) {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            createdAt: {
              ...(query.dateFrom ? { gte: parseDateOnly(query.dateFrom) } : {}),
              // Inclusive of the whole end day: a filter to "30 September"
              // that excluded 30 September would be a bug report.
              ...(query.dateTo
                ? { lt: new Date(parseDateOnly(query.dateTo).getTime() + 86_400_000) }
                : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { action: { contains: query.search, mode: 'insensitive' } },
              { actorEmail: { contains: query.search, mode: 'insensitive' } },
              { entityType: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.db.auditLog.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          userId: true,
          actorEmail: true,
          action: true,
          entityType: true,
          entityId: true,
          metadata: true,
          createdAt: true,
          user: { select: { id: true, fullName: true } },
        },
      }),
      this.db.auditLog.count({ where }),
    ]);

    return paginated(rows, total, query.page, query.limit);
  }

  /** The distinct actions actually present, so the filter offers real choices. */
  async actions(): Promise<string[]> {
    const rows = await this.db.auditLog.findMany({
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
      take: 200,
    });
    return rows.map((row) => row.action);
  }
}

import { Injectable } from '@nestjs/common';
import type { RoleName } from '@pm/types';
import { paginated } from '@/common/dto/pagination.dto';
import { NotFoundError } from '@/common/errors/domain.errors';
import { InjectScopedPrisma } from '@/prisma/prisma.module';
import type { ScopedPrismaClient } from '@/prisma/tenant-scope.extension';
import type { ListUsersQueryDto } from './dto/list-users.dto';

/**
 * Read-only user directory for Phase 1.
 *
 * Creating staff, assigning roles and assigning properties is the StaffModule
 * in Phase 5 — it needs the Property table to be meaningful, so it is not
 * pretended at here.
 *
 * Every query goes through the tenant-scoped client, so `organizationId` is
 * injected automatically and a user from another organization is not merely
 * hidden — it is not queried for at all.
 */
@Injectable()
export class UsersService {
  constructor(@InjectScopedPrisma() private readonly db: ScopedPrismaClient) {}

  async list(query: ListUsersQueryDto) {
    const where = query.search
      ? {
          OR: [
            { fullName: { contains: query.search, mode: 'insensitive' as const } },
            { email: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [rows, total] = await Promise.all([
      this.db.user.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: query.sortOrder },
        select: {
          id: true,
          email: true,
          fullName: true,
          phone: true,
          status: true,
          emailVerifiedAt: true,
          lastLoginAt: true,
          createdAt: true,
          roles: { select: { role: { select: { name: true, label: true } } } },
        },
      }),
      this.db.user.count({ where }),
    ]);

    const data = rows.map((user) => ({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      status: user.status,
      emailVerified: user.emailVerifiedAt !== null,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      roles: user.roles.map((link) => link.role.name as RoleName),
    }));

    return paginated(data, total, query.page, query.limit);
  }

  async findOne(id: string) {
    const user = await this.db.user.findFirst({
      where: { id },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        avatarUrl: true,
        status: true,
        emailVerifiedAt: true,
        lastLoginAt: true,
        createdAt: true,
        roles: { select: { role: { select: { name: true, label: true } } } },
      },
    });
    // A user in another organization produces exactly this 404 — never a 403,
    // which would confirm the record exists.
    if (!user) throw new NotFoundError('User');

    return {
      ...user,
      emailVerified: user.emailVerifiedAt !== null,
      roles: user.roles.map((link) => link.role.name as RoleName),
    };
  }
}

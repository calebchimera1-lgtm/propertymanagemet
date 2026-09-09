import { Injectable } from '@nestjs/common';
import { type Permission, type RoleName, isPermission } from '@pm/types';
import { PrismaService } from '@/prisma/prisma.service';

interface ResolvedAccess {
  roles: RoleName[];
  permissions: Permission[];
}

const CACHE_TTL_MS = 60_000;

/**
 * Resolves a user's roles and effective permissions.
 *
 * Reads use the UNSCOPED client on purpose: this runs inside the auth guard,
 * before a tenant context exists. It is safe because every query is keyed by a
 * user id that was itself resolved from the session cookie — there is no
 * caller-supplied input on this path.
 *
 * Results are cached for 60 seconds and invalidated explicitly whenever roles
 * change, so a revoked role does not stay live for a minute.
 */
@Injectable()
export class PermissionsService {
  private readonly cache = new Map<string, { expiresAt: number; value: ResolvedAccess }>();

  constructor(private readonly prisma: PrismaService) {}

  async forUser(userId: string): Promise<ResolvedAccess> {
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const assignments = await this.prisma.userRole.findMany({
      where: { userId },
      select: {
        role: {
          select: {
            name: true,
            permissions: { select: { permission: { select: { key: true } } } },
          },
        },
      },
    });

    const roles: RoleName[] = [];
    const permissions = new Set<Permission>();

    for (const assignment of assignments) {
      roles.push(assignment.role.name as RoleName);
      for (const link of assignment.role.permissions) {
        const key = link.permission.key;
        if (isPermission(key)) permissions.add(key);
      }
    }

    const value: ResolvedAccess = { roles, permissions: [...permissions].sort() };
    this.cache.set(userId, { expiresAt: Date.now() + CACHE_TTL_MS, value });
    return value;
  }

  /** Called whenever a role assignment or the permission matrix changes. */
  invalidate(userId?: string): void {
    if (userId) this.cache.delete(userId);
    else this.cache.clear();
  }

  async listCatalogue() {
    return this.prisma.permission.findMany({
      orderBy: [{ resource: 'asc' }, { action: 'asc' }],
      select: { id: true, key: true, resource: true, action: true, description: true },
    });
  }

  async listRoles() {
    return this.prisma.role.findMany({
      where: { organizationId: null },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        label: true,
        description: true,
        permissions: { select: { permission: { select: { key: true } } } },
      },
    });
  }
}

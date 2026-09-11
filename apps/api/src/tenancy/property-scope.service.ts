import { Injectable } from '@nestjs/common';
import { PROPERTY_SCOPED_ROLES, type RoleName } from '@pm/types';
import { NotFoundError } from '@/common/errors/domain.errors';
import { PrismaService } from '@/prisma/prisma.service';
import { TenantContextService } from './tenant-context.service';

/**
 * Layer 4 of the multi-tenant model (blueprint §9): which properties a
 * property-scoped user may see.
 *
 * Implemented as a service rather than a route guard. A guard runs before the
 * handler and cannot know which rows a list endpoint is about to touch, so
 * scoping has to be part of the query. Every portfolio query therefore composes
 * `where()` into its filter, and every by-id read calls `assertProperty()`.
 *
 * The default is restrictive: a scoped user with no assignments gets an empty
 * id list and sees nothing. There is no code path where "no assignments" means
 * "no restriction".
 */
@Injectable()
export class PropertyScopeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /** True when the caller's roles restrict them to assigned properties. */
  static isScoped(roles: RoleName[]): boolean {
    return roles.length > 0 && roles.every((role) => PROPERTY_SCOPED_ROLES.includes(role));
  }

  /**
   * Resolves the caller's property scope. Called by the auth guard, which has a
   * user id from the session and no client input at all.
   *
   * Returns null for unrestricted roles (owner, manager, super admin) — a
   * distinct value from `[]`, which means "restricted, and to nothing".
   */
  async resolve(userId: string, roles: RoleName[]): Promise<string[] | null> {
    if (!PropertyScopeService.isScoped(roles)) return null;

    // Deliberately uncached.
    //
    // A cache here would mean a caretaker keeps access to a property for up to
    // its TTL after the assignment is revoked, and waits that long for a new
    // one. This is a single indexed lookup by user id, and it only runs for the
    // property-scoped roles — not a cost worth trading correctness for.
    const assignments = await this.prisma.staffAssignment.findMany({
      where: { userId },
      select: { propertyId: true },
    });

    return assignments.map((assignment) => assignment.propertyId);
  }

  /** The caller's scope, or null when unrestricted. */
  private current(): string[] | null {
    return this.tenant.getOrThrow().scopedPropertyIds;
  }

  /**
   * Filter fragment for any model with a `propertyId` column.
   * Spread it into a Prisma `where`: `{ ...scope.where(), status: 'ACTIVE' }`.
   */
  where(): { propertyId?: { in: string[] } } {
    const ids = this.current();
    return ids === null ? {} : { propertyId: { in: ids } };
  }

  /** The same, for querying the Property table itself. */
  whereProperty(): { id?: { in: string[] } } {
    const ids = this.current();
    return ids === null ? {} : { id: { in: ids } };
  }

  /**
   * Guards a by-id read or write.
   *
   * Throws NotFound rather than Forbidden on purpose: telling a caretaker that
   * a property exists but is not theirs is more than they should know.
   */
  assertProperty(propertyId: string, entity = 'Property'): void {
    const ids = this.current();
    if (ids !== null && !ids.includes(propertyId)) {
      throw new NotFoundError(entity);
    }
  }

  get isRestricted(): boolean {
    return this.current() !== null;
  }

  /**
   * The scope as an id list, for raw SQL that cannot use a Prisma `where`.
   *
   * Returns null when unrestricted — callers must branch on that rather than
   * treating an empty array as "no filter", which is the failure mode this
   * whole layer exists to prevent.
   */
  get propertyIds(): string[] | null {
    return this.current();
  }
}

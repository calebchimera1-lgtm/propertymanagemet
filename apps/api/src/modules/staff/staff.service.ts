import { randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@pm/database';
import { PROPERTY_SCOPED_ROLES, type RoleName } from '@pm/types';
import { paginated } from '@/common/dto/pagination.dto';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/common/errors/domain.errors';
import { AppConfig } from '@/config/app.config';
import { AUDIT_ACTIONS, AuditLogService } from '@/modules/audit-logs/audit-log.service';
import { PasswordService } from '@/modules/auth/password.service';
import { TokenService } from '@/modules/auth/token.service';
import { InjectScopedPrisma } from '@/prisma/prisma.module';
import { PrismaService } from '@/prisma/prisma.service';
import type { ScopedPrismaClient } from '@/prisma/tenant-scope.extension';
import { TenantContextService } from '@/tenancy/tenant-context.service';
import type {
  AssignPropertiesDto,
  CreateStaffDto,
  ListStaffQueryDto,
  UpdateStaffDto,
} from './dto/staff.dto';

const STAFF_SELECT = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  status: true,
  emailVerifiedAt: true,
  lastLoginAt: true,
  createdAt: true,
  roles: { select: { role: { select: { id: true, name: true, label: true } } } },
  staffAssignments: {
    select: { propertyId: true, property: { select: { id: true, name: true } } },
  },
} satisfies Prisma.UserSelect;

type StaffRow = Prisma.UserGetPayload<{ select: typeof STAFF_SELECT }>;

/** An invite is valid for a week — long enough to reach someone, short enough to expire. */
const INVITE_TTL_MINUTES = 60 * 24 * 7;

/**
 * Staff: who works here, what they may do, and which properties they may see.
 *
 * This is the module with the most ways to go wrong, so the guards are explicit
 * rather than implied:
 *
 *   - SUPER_ADMIN is not assignable (the DTO refuses it) — it is a platform
 *     role, and a dropdown that granted it would be a privilege-escalation path.
 *   - Nobody may change their own role, deactivate themselves, or delete
 *     themselves. An admin locking themselves out is a support ticket; an admin
 *     quietly promoting themselves is a breach.
 *   - The last active owner cannot be demoted, deactivated or deleted. An
 *     organization with nobody who can administer it is unrecoverable.
 *   - Property assignments are replaced as a set, and take effect on the
 *     person's very next request — PropertyScopeService resolves them fresh
 *     every time, with no cache to wait out.
 */
@Injectable()
export class StaffService {
  private readonly logger = new Logger(StaffService.name);

  constructor(
    @InjectScopedPrisma() private readonly db: ScopedPrismaClient,
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditLogService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly config: AppConfig,
  ) {}

  private serialise(user: StaffRow) {
    const roles = user.roles.map((link) => link.role.name as RoleName);
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      status: user.status,
      emailVerified: Boolean(user.emailVerifiedAt),
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      roles,
      roleLabels: user.roles.map((link) => link.role.label),
      /**
       * null means unrestricted, [] means restricted to nothing. The two are
       * different answers and the UI has to be able to tell them apart.
       */
      properties: PropertyScoped(roles)
        ? user.staffAssignments.map((assignment) => assignment.property)
        : null,
    };
  }

  private async requireRole(name: RoleName) {
    return this.prisma.role.findFirstOrThrow({
      where: { name, organizationId: null },
      select: { id: true, name: true, label: true },
    });
  }

  /**
   * Refuses an action that would leave the organization with no active owner.
   *
   * Counted with the unscoped client on purpose: this must be the true count
   * for the organization, not a count filtered by whatever the caller can see.
   */
  private async assertNotLastOwner(organizationId: string, userId: string): Promise<void> {
    const owners = await this.prisma.user.count({
      where: {
        organizationId,
        status: 'ACTIVE',
        id: { not: userId },
        roles: { some: { role: { name: 'PROPERTY_OWNER' } } },
      },
    });
    if (owners === 0) {
      throw new ConflictError(
        'LAST_OWNER',
        'This is the only active owner. Promote someone else to owner first — an organization with no owner cannot be administered.',
      );
    }
  }

  private assertNotSelf(userId: string, action: string): void {
    const auth = this.tenant.getOrThrow();
    if (auth.userId === userId) {
      throw new ForbiddenError(`You cannot ${action} your own account.`);
    }
  }

  private async findStaffOrThrow(id: string): Promise<StaffRow> {
    const user = await this.db.user.findFirst({ where: { id }, select: STAFF_SELECT });
    if (!user) throw new NotFoundError('Staff member');
    return user;
  }

  /** Every property id must exist in this organization; anything else is a 404. */
  private async assertPropertiesExist(propertyIds: string[]): Promise<void> {
    if (propertyIds.length === 0) return;
    const unique = [...new Set(propertyIds)];
    const found = await this.db.property.count({ where: { id: { in: unique } } });
    if (found !== unique.length) throw new NotFoundError('Property');
  }

  async list(query: ListStaffQueryDto) {
    const where: Prisma.UserWhereInput = {
      ...(query.role ? { roles: { some: { role: { name: query.role } } } } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.propertyId
        ? { staffAssignments: { some: { propertyId: query.propertyId } } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { fullName: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.db.user.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder },
        select: STAFF_SELECT,
      }),
      this.db.user.count({ where }),
    ]);

    return paginated(rows.map((row) => this.serialise(row)), total, query.page, query.limit);
  }

  async findOne(id: string) {
    return this.serialise(await this.findStaffOrThrow(id));
  }

  async listProperties(id: string) {
    const staff = await this.findStaffOrThrow(id);
    return {
      unrestricted: !PropertyScoped(staff.roles.map((link) => link.role.name as RoleName)),
      properties: staff.staffAssignments.map((assignment) => assignment.property),
    };
  }

  /**
   * Creates a staff account and returns a one-time invite link.
   *
   * Email is not delivered in Version 1, so a link that only went to the server
   * log would leave an owner unable to onboard anyone. It is returned here —
   * once, to an authenticated caller who already holds `staff.create` — for
   * them to hand over, and it is never readable again from any endpoint. The
   * account cannot be signed into until that link is used: its stored password
   * hash is of a random secret nobody has ever seen.
   */
  async create(dto: CreateStaffDto) {
    const auth = this.tenant.getOrThrow();

    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictError(
        'EMAIL_TAKEN',
        'An account already exists with that email address.',
        [{ field: 'email', message: 'This email address is already registered.' }],
      );
    }

    const role = await this.requireRole(dto.role);
    const propertyIds = [...new Set(dto.propertyIds ?? [])];
    await this.assertPropertiesExist(propertyIds);

    if (!PropertyScoped([dto.role]) && propertyIds.length > 0) {
      throw new ValidationError(
        `${role.label}s can already see every property, so assigning specific ones would be misleading.`,
        [{ field: 'propertyIds', message: 'This role is not restricted to specific properties.' }],
      );
    }

    // Unguessable and unknown to anyone, including us: the invite is the only
    // way in, and it is single-use.
    const placeholder = await this.passwords.hash(randomBytes(32).toString('base64url'));
    const { token, tokenHash } = this.tokens.generate();

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          organizationId: auth.organizationId,
          email: dto.email,
          passwordHash: placeholder,
          fullName: dto.fullName,
          phone: dto.phone ?? null,
          status: 'INVITED',
        },
        select: { id: true },
      });

      await tx.userRole.create({
        data: { userId: created.id, roleId: role.id, organizationId: auth.organizationId },
      });

      if (propertyIds.length > 0) {
        await tx.staffAssignment.createMany({
          data: propertyIds.map((propertyId) => ({
            organizationId: auth.organizationId,
            userId: created.id,
            propertyId,
            assignedById: auth.userId,
          })),
        });
      }

      await tx.passwordResetToken.create({
        data: {
          userId: created.id,
          tokenHash,
          expiresAt: this.tokens.expiresIn(INVITE_TTL_MINUTES),
        },
      });

      return created;
    });

    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.STAFF_INVITED,
      entityType: 'User',
      entityId: user.id,
      // The token is deliberately not in the metadata — an audit row is not a
      // place to leave a working credential.
      metadata: { email: dto.email, role: dto.role, propertyCount: propertyIds.length },
    });

    const inviteUrl = `${this.config.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
    this.logger.log(`Staff invite created for ${dto.email}: ${inviteUrl}`);

    return {
      staff: await this.findOne(user.id),
      invite: {
        url: inviteUrl,
        expiresInDays: Math.round(INVITE_TTL_MINUTES / (60 * 24)),
        /** Said plainly so the UI can repeat it rather than implying an email went out. */
        note: 'Email delivery is not enabled in this version. Copy this link and send it to them yourself — it is shown once and cannot be retrieved later.',
      },
    };
  }

  async update(id: string, dto: UpdateStaffDto) {
    const auth = this.tenant.getOrThrow();
    const staff = await this.findStaffOrThrow(id);

    if (dto.role) {
      this.assertNotSelf(id, 'change the role on');

      const currentRoles = staff.roles.map((link) => link.role.name as RoleName);
      if (currentRoles.includes('PROPERTY_OWNER') && dto.role !== 'PROPERTY_OWNER') {
        await this.assertNotLastOwner(auth.organizationId, id);
      }
    }

    const role = dto.role ? await this.requireRole(dto.role) : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          ...(dto.fullName !== undefined ? { fullName: dto.fullName } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        },
      });

      if (role) {
        // One role per user in V1: replace rather than accumulate, so
        // "what can this person do" always has a single answer.
        await tx.userRole.deleteMany({ where: { userId: id } });
        await tx.userRole.create({
          data: { userId: id, roleId: role.id, organizationId: auth.organizationId },
        });

        // A role change can flip someone from scoped to unrestricted. Leaving
        // stale assignments behind would silently re-restrict them if they were
        // ever demoted again.
        if (!PropertyScoped([role.name as RoleName])) {
          await tx.staffAssignment.deleteMany({ where: { userId: id } });
        }
      }
    });

    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: role ? AUDIT_ACTIONS.STAFF_ROLE_CHANGED : AUDIT_ACTIONS.STAFF_UPDATED,
      entityType: 'User',
      entityId: id,
      metadata: { changed: Object.keys(dto), role: dto.role ?? null },
    });

    return this.findOne(id);
  }

  async assignProperties(id: string, dto: AssignPropertiesDto) {
    const auth = this.tenant.getOrThrow();
    const staff = await this.findStaffOrThrow(id);
    const roles = staff.roles.map((link) => link.role.name as RoleName);

    if (!PropertyScoped(roles)) {
      throw new ValidationError(
        'This person’s role already covers every property, so a specific assignment would have no effect.',
        [{ field: 'propertyIds', message: 'Only caretakers and accountants are property-scoped.' }],
      );
    }

    const propertyIds = [...new Set(dto.propertyIds)];
    await this.assertPropertiesExist(propertyIds);

    await this.prisma.$transaction(async (tx) => {
      await tx.staffAssignment.deleteMany({ where: { userId: id } });
      if (propertyIds.length > 0) {
        await tx.staffAssignment.createMany({
          data: propertyIds.map((propertyId) => ({
            organizationId: auth.organizationId,
            userId: id,
            propertyId,
            assignedById: auth.userId,
          })),
        });
      }
    });

    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.STAFF_PROPERTIES_ASSIGNED,
      entityType: 'User',
      entityId: id,
      metadata: { propertyIds },
    });

    return this.listProperties(id);
  }

  async setActive(id: string, active: boolean) {
    const auth = this.tenant.getOrThrow();
    await this.findStaffOrThrow(id);

    if (!active) {
      this.assertNotSelf(id, 'deactivate');
      await this.assertNotLastOwner(auth.organizationId, id);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { status: active ? 'ACTIVE' : 'INACTIVE' },
      });

      if (!active) {
        // Deactivation has to end the sessions too, or the person keeps
        // working until their cookie happens to expire.
        await tx.session.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    });

    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: active ? AUDIT_ACTIONS.STAFF_ACTIVATED : AUDIT_ACTIONS.STAFF_DEACTIVATED,
      entityType: 'User',
      entityId: id,
    });

    return this.findOne(id);
  }

  /**
   * Hard delete, and only for someone who has left no trace.
   *
   * A user who has recorded a payment, issued a receipt or written an audit row
   * is part of the record. Deactivating keeps the history readable; deleting is
   * for an invite sent to the wrong address.
   */
  async remove(id: string): Promise<void> {
    const auth = this.tenant.getOrThrow();
    const staff = await this.findStaffOrThrow(id);

    this.assertNotSelf(id, 'delete');
    await this.assertNotLastOwner(auth.organizationId, id);

    const [payments, receipts, auditRows] = await Promise.all([
      this.prisma.payment.count({ where: { recordedById: id } }),
      this.prisma.receipt.count({ where: { issuedById: id } }),
      this.prisma.auditLog.count({ where: { userId: id } }),
    ]);

    if (payments > 0 || receipts > 0 || auditRows > 0) {
      throw new ConflictError(
        'STAFF_HAS_HISTORY',
        `${staff.fullName} has recorded ${payments} payment(s) and ${receipts} receipt(s), and appears in the audit trail. ` +
          'Deactivate them instead — that ends their access and keeps the record intact.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.session.deleteMany({ where: { userId: id } });
      await tx.passwordResetToken.deleteMany({ where: { userId: id } });
      await tx.emailVerificationToken.deleteMany({ where: { userId: id } });
      await tx.staffAssignment.deleteMany({ where: { userId: id } });
      await tx.userRole.deleteMany({ where: { userId: id } });
      await tx.user.delete({ where: { id } });
    });

    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.STAFF_DELETED,
      entityType: 'User',
      entityId: id,
      metadata: { email: staff.email, fullName: staff.fullName },
    });
  }
}

/** True when every one of these roles is restricted to assigned properties. */
function PropertyScoped(roles: RoleName[]): boolean {
  return roles.length > 0 && roles.every((role) => PROPERTY_SCOPED_ROLES.includes(role));
}

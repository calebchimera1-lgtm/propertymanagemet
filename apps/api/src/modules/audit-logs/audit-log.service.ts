import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@pm/database';
import { PrismaService } from '@/prisma/prisma.service';
import { TenantContextService } from '@/tenancy/tenant-context.service';

export interface AuditEntry {
  organizationId: string;
  userId?: string | null;
  actorEmail: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Append-only audit trail.
 *
 * Two rules this service exists to keep:
 *   1. Writing an audit row must never break the user's request. A failed log
 *      is logged and swallowed — losing an audit entry is bad, failing a
 *      recorded payment because of one is worse.
 *   2. Nothing sensitive is ever written. Metadata is filtered against a
 *      denylist so a careless caller cannot put a password or token in the
 *      trail.
 *
 * The authorized read endpoint and its UI arrive in Phase 5; the auth flows
 * already write here.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  private static readonly FORBIDDEN_KEYS = [
    'password',
    'passwordhash',
    'newpassword',
    'currentpassword',
    'token',
    'tokenhash',
    'csrfsecret',
    'secret',
    'authorization',
    'cookie',
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  async record(entry: AuditEntry): Promise<void> {
    const store = this.tenant.store();
    try {
      await this.prisma.auditLog.create({
        data: {
          organizationId: entry.organizationId,
          userId: entry.userId ?? null,
          actorEmail: entry.actorEmail,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          metadata: entry.metadata
            ? (this.sanitise(entry.metadata) as Prisma.InputJsonValue)
            : undefined,
          ipAddress: entry.ipAddress ?? store?.ipAddress ?? null,
          userAgent: entry.userAgent ?? store?.userAgent ?? null,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to write audit log for ${entry.action}: ${String(error)}`);
    }
  }

  /** Strips anything that looks like a credential, at any depth. */
  private sanitise(metadata: Record<string, unknown>): Record<string, unknown> {
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (AuditLogService.FORBIDDEN_KEYS.includes(key.toLowerCase())) {
        clean[key] = '[redacted]';
        continue;
      }
      clean[key] =
        value !== null && typeof value === 'object' && !Array.isArray(value)
          ? this.sanitise(value as Record<string, unknown>)
          : value;
    }
    return clean;
  }
}

/** Canonical action names. Kept as constants so reports can group on them. */
export const AUDIT_ACTIONS = {
  ORGANIZATION_CREATED: 'ORGANIZATION_CREATED',
  ORGANIZATION_UPDATED: 'ORGANIZATION_UPDATED',
  USER_REGISTERED: 'USER_REGISTERED',
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILED: 'LOGIN_FAILED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  LOGOUT: 'LOGOUT',
  LOGOUT_ALL: 'LOGOUT_ALL',
  SESSION_REVOKED: 'SESSION_REVOKED',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  PASSWORD_RESET_REQUESTED: 'PASSWORD_RESET_REQUESTED',
  PASSWORD_RESET_COMPLETED: 'PASSWORD_RESET_COMPLETED',
  EMAIL_VERIFIED: 'EMAIL_VERIFIED',
  PROFILE_UPDATED: 'PROFILE_UPDATED',
  SETTINGS_UPDATED: 'SETTINGS_UPDATED',

  PROPERTY_CREATED: 'PROPERTY_CREATED',
  PROPERTY_UPDATED: 'PROPERTY_UPDATED',
  PROPERTY_ARCHIVED: 'PROPERTY_ARCHIVED',
  PROPERTY_DELETED: 'PROPERTY_DELETED',
  BUILDING_CREATED: 'BUILDING_CREATED',
  BUILDING_UPDATED: 'BUILDING_UPDATED',
  BUILDING_DELETED: 'BUILDING_DELETED',
  UNIT_CREATED: 'UNIT_CREATED',
  UNIT_UPDATED: 'UNIT_UPDATED',
  UNIT_STATUS_CHANGED: 'UNIT_STATUS_CHANGED',
  UNIT_DELETED: 'UNIT_DELETED',

  TENANT_CREATED: 'TENANT_CREATED',
  TENANT_UPDATED: 'TENANT_UPDATED',
  TENANT_DELETED: 'TENANT_DELETED',
  LEASE_CREATED: 'LEASE_CREATED',
  LEASE_UPDATED: 'LEASE_UPDATED',
  LEASE_RENEWED: 'LEASE_RENEWED',
  LEASE_TERMINATED: 'LEASE_TERMINATED',
  LEASE_STATUS_DERIVED: 'LEASE_STATUS_DERIVED',

  RENT_GENERATED: 'RENT_GENERATED',
  PAYMENT_RECORDED: 'PAYMENT_RECORDED',
  PAYMENT_VOIDED: 'PAYMENT_VOIDED',
  RECEIPT_ISSUED: 'RECEIPT_ISSUED',
  EXPENSE_CREATED: 'EXPENSE_CREATED',
  EXPENSE_UPDATED: 'EXPENSE_UPDATED',
  EXPENSE_DELETED: 'EXPENSE_DELETED',
} as const;

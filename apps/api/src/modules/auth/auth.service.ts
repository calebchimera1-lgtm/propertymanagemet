import { Inject, Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES, type MeResponse, type RoleName } from '@pm/types';
import type { Request } from 'express';
import {
  ConflictError,
  DomainError,
  NotFoundError,
  UnauthenticatedError,
} from '@/common/errors/domain.errors';
import { AppConfig } from '@/config/app.config';
import { PrismaService } from '@/prisma/prisma.service';
import { AUDIT_ACTIONS, AuditLogService } from '@/modules/audit-logs/audit-log.service';
import { PermissionsService } from '@/modules/permissions/permissions.service';
import { EMAIL_PROVIDER, type EmailProvider } from '@/providers/email/email-provider.interface';
import type { AuthContext } from '@/tenancy/tenant-context';
import { TenantContextService } from '@/tenancy/tenant-context.service';
import type {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  UpdateProfileDto,
  VerifyEmailDto,
} from './dto/auth.dto';
import { PasswordService } from './password.service';
import { type IssuedSession, SessionService } from './session.service';
import {
  EMAIL_VERIFICATION_TTL_MINUTES,
  PASSWORD_RESET_TTL_MINUTES,
  TokenService,
} from './token.service';

/** Failed attempts before the account is temporarily locked. */
const MAX_FAILED_LOGINS = 10;
const LOCKOUT_MINUTES = 15;

export interface AuthResult {
  session: IssuedSession;
  me: MeResponse;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly tokens: TokenService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditLogService,
    private readonly tenant: TenantContextService,
    private readonly config: AppConfig,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
  ) {}

  // ── Registration ──────────────────────────────────────────────────────────

  /**
   * Creates the organization and its first owner atomically. If any step fails
   * — including seeding the settings row — nothing is written, so there is no
   * such thing as an organization without an owner.
   */
  async register(dto: RegisterDto, request: Request): Promise<AuthResult> {
    this.passwords.assertAcceptable(dto.password, { email: dto.email });

    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });
    if (existing) {
      // Registration has to tell the truth here: the alternative is silently
      // doing nothing and leaving the person unable to explain why.
      throw new ConflictError(
        ERROR_CODES.EMAIL_ALREADY_REGISTERED,
        'An account with that email address already exists.',
        [{ field: 'email', message: 'This email is already registered.' }],
      );
    }

    const passwordHash = await this.passwords.hash(dto.password);
    const code = await this.generateOrganizationCode(dto.organizationName);
    const ownerRole = await this.systemRoleId('PROPERTY_OWNER');
    const verification = this.tokens.generate();

    const { user, organization } = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: dto.organizationName,
          code,
          email: dto.email,
          currency: this.config.defaultCurrency,
          timezone: this.config.defaultTimezone,
          settings: { create: {} },
        },
        select: { id: true, name: true, code: true, currency: true, timezone: true, status: true },
      });

      const user = await tx.user.create({
        data: {
          organizationId: organization.id,
          email: dto.email,
          passwordHash,
          fullName: dto.fullName,
          status: 'ACTIVE',
        },
      });

      await tx.userRole.create({
        data: { userId: user.id, roleId: ownerRole, organizationId: organization.id },
      });

      await tx.emailVerificationToken.create({
        data: {
          userId: user.id,
          tokenHash: verification.tokenHash,
          expiresAt: this.tokens.expiresIn(EMAIL_VERIFICATION_TTL_MINUTES),
        },
      });

      return { user, organization };
    });

    await this.audit.record({
      organizationId: organization.id,
      userId: user.id,
      actorEmail: user.email,
      action: AUDIT_ACTIONS.ORGANIZATION_CREATED,
      entityType: 'Organization',
      entityId: organization.id,
      metadata: { name: organization.name, code: organization.code },
    });
    await this.audit.record({
      organizationId: organization.id,
      userId: user.id,
      actorEmail: user.email,
      action: AUDIT_ACTIONS.USER_REGISTERED,
      entityType: 'User',
      entityId: user.id,
    });

    await this.sendVerificationEmail(user.email, verification.token);

    const session = await this.sessions.issue(user.id, organization.id, request);
    return { session, me: await this.buildMe(user.id) };
  }

  // ── Login ─────────────────────────────────────────────────────────────────

  async login(dto: LoginDto, request: Request): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        status: true,
        failedLoginCount: true,
        lockedUntil: true,
        organizationId: true,
        organization: { select: { status: true } },
      },
    });

    // Unknown email: burn the same CPU, return the same message. The response
    // must not reveal whether the account exists.
    if (!user) {
      await this.passwords.verifyDummy(dto.password);
      throw this.invalidCredentials();
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new DomainError(
        ERROR_CODES.ACCOUNT_LOCKED,
        `Too many failed sign-in attempts. Try again in ${LOCKOUT_MINUTES} minutes.`,
        423,
      );
    }

    const valid = await this.passwords.verify(user.passwordHash, dto.password);
    if (!valid) {
      await this.registerFailedLogin(user.id, user.organizationId, user.email, user.failedLoginCount);
      throw this.invalidCredentials();
    }

    if (user.status !== 'ACTIVE' || user.organization.status !== 'ACTIVE') {
      throw new DomainError(
        ERROR_CODES.ACCOUNT_INACTIVE,
        'This account is not active. Contact your administrator.',
        403,
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    const session = await this.sessions.issue(user.id, user.organizationId, request);

    await this.audit.record({
      organizationId: user.organizationId,
      userId: user.id,
      actorEmail: user.email,
      action: AUDIT_ACTIONS.LOGIN_SUCCESS,
      entityType: 'Session',
      entityId: session.sessionId,
    });

    return { session, me: await this.buildMe(user.id) };
  }

  private invalidCredentials(): UnauthenticatedError {
    return new UnauthenticatedError(
      ERROR_CODES.INVALID_CREDENTIALS,
      'Email or password is incorrect.',
    );
  }

  private async registerFailedLogin(
    userId: string,
    organizationId: string,
    email: string,
    currentCount: number,
  ): Promise<void> {
    const nextCount = currentCount + 1;
    const shouldLock = nextCount >= MAX_FAILED_LOGINS;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginCount: nextCount,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000) : null,
      },
    });

    await this.audit.record({
      organizationId,
      userId,
      actorEmail: email,
      action: shouldLock ? AUDIT_ACTIONS.ACCOUNT_LOCKED : AUDIT_ACTIONS.LOGIN_FAILED,
      entityType: 'User',
      entityId: userId,
      metadata: { attempt: nextCount },
    });
  }

  // ── Session lifecycle ─────────────────────────────────────────────────────

  async logout(auth: AuthContext): Promise<void> {
    await this.sessions.revoke(auth.sessionId);
    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.LOGOUT,
      entityType: 'Session',
      entityId: auth.sessionId,
    });
  }

  async logoutEverywhere(auth: AuthContext): Promise<{ revoked: number }> {
    const revoked = await this.sessions.revokeAllForUser(auth.userId);
    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.LOGOUT_ALL,
      entityType: 'User',
      entityId: auth.userId,
      metadata: { revoked },
    });
    return { revoked };
  }

  listSessions(auth: AuthContext) {
    return this.sessions.listForUser(auth.userId, auth.sessionId);
  }

  async revokeSession(auth: AuthContext, sessionId: string): Promise<void> {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, userId: auth.userId },
      select: { id: true },
    });
    if (!session) throw new NotFoundError('Session');

    await this.sessions.revoke(sessionId);
    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.SESSION_REVOKED,
      entityType: 'Session',
      entityId: sessionId,
    });
  }

  // ── Password lifecycle ────────────────────────────────────────────────────

  /**
   * Always reports success. Confirming whether an address is registered would
   * turn this endpoint into an account-enumeration tool.
   */
  async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true, email: true, fullName: true, status: true, organizationId: true },
    });

    if (!user || user.status !== 'ACTIVE') {
      this.logger.debug(`Password reset requested for unknown or inactive address ${dto.email}`);
      return;
    }

    const { token, tokenHash } = this.tokens.generate();
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: this.tokens.expiresIn(PASSWORD_RESET_TTL_MINUTES),
        ipAddress: this.tenant.store()?.ipAddress ?? null,
      },
    });

    await this.audit.record({
      organizationId: user.organizationId,
      userId: user.id,
      actorEmail: user.email,
      action: AUDIT_ACTIONS.PASSWORD_RESET_REQUESTED,
      entityType: 'User',
      entityId: user.id,
    });

    const link = `${this.config.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
    await this.email.send({
      to: user.email,
      subject: 'Reset your password',
      text: [
        `Hello ${user.fullName},`,
        '',
        'Use the link below to choose a new password. It expires in 1 hour and can be used once.',
        '',
        link,
        '',
        'If you did not request this, you can ignore this message — nothing has changed.',
      ].join('\n'),
    });
  }

  /** Consumes the token, sets the new password, and kills every session. */
  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: this.tokens.hash(dto.token) },
      select: {
        id: true,
        usedAt: true,
        expiresAt: true,
        user: { select: { id: true, email: true, organizationId: true } },
      },
    });

    if (!record || record.usedAt || record.expiresAt <= new Date()) {
      throw new DomainError(
        ERROR_CODES.INVALID_TOKEN,
        'This reset link is invalid or has expired. Request a new one.',
        400,
      );
    }

    this.passwords.assertAcceptable(dto.password, { email: record.user.email });
    const passwordHash = await this.passwords.hash(dto.password);

    await this.prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      });
      await tx.user.update({
        where: { id: record.user.id },
        data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
      });
      // Whoever was signed in as this user — including an attacker — is out.
      await tx.session.updateMany({
        where: { userId: record.user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    await this.audit.record({
      organizationId: record.user.organizationId,
      userId: record.user.id,
      actorEmail: record.user.email,
      action: AUDIT_ACTIONS.PASSWORD_RESET_COMPLETED,
      entityType: 'User',
      entityId: record.user.id,
    });
  }

  async changePassword(auth: AuthContext, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: auth.userId },
      select: { id: true, email: true, passwordHash: true },
    });
    if (!user) throw new NotFoundError('User');

    const valid = await this.passwords.verify(user.passwordHash, dto.currentPassword);
    if (!valid) {
      throw new DomainError(
        ERROR_CODES.INVALID_CREDENTIALS,
        'Your current password is incorrect.',
        422,
        [{ field: 'currentPassword', message: 'Incorrect password.' }],
      );
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new DomainError(
        ERROR_CODES.VALIDATION_FAILED,
        'The new password must be different from the current one.',
        422,
        [{ field: 'newPassword', message: 'Choose a different password.' }],
      );
    }

    this.passwords.assertAcceptable(dto.newPassword, { email: user.email });
    const passwordHash = await this.passwords.hash(dto.newPassword);

    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    // Every other browser is signed out; this one stays.
    const revoked = await this.sessions.revokeAllForUser(user.id, auth.sessionId);

    await this.audit.record({
      organizationId: auth.organizationId,
      userId: user.id,
      actorEmail: user.email,
      action: AUDIT_ACTIONS.PASSWORD_CHANGED,
      entityType: 'User',
      entityId: user.id,
      metadata: { otherSessionsRevoked: revoked },
    });
  }

  // ── Email verification ────────────────────────────────────────────────────

  async verifyEmail(dto: VerifyEmailDto): Promise<void> {
    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash: this.tokens.hash(dto.token) },
      select: {
        id: true,
        usedAt: true,
        expiresAt: true,
        user: { select: { id: true, email: true, organizationId: true, emailVerifiedAt: true } },
      },
    });

    if (!record || record.usedAt || record.expiresAt <= new Date()) {
      throw new DomainError(
        ERROR_CODES.INVALID_TOKEN,
        'This verification link is invalid or has expired.',
        400,
      );
    }

    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: record.user.id },
        data: { emailVerifiedAt: new Date() },
      }),
    ]);

    await this.audit.record({
      organizationId: record.user.organizationId,
      userId: record.user.id,
      actorEmail: record.user.email,
      action: AUDIT_ACTIONS.EMAIL_VERIFIED,
      entityType: 'User',
      entityId: record.user.id,
    });
  }

  async resendVerification(auth: AuthContext): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: auth.userId },
      select: { id: true, email: true, emailVerifiedAt: true },
    });
    if (!user || user.emailVerifiedAt) return;

    const { token, tokenHash } = this.tokens.generate();
    await this.prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: this.tokens.expiresIn(EMAIL_VERIFICATION_TTL_MINUTES),
      },
    });
    await this.sendVerificationEmail(user.email, token);
  }

  private async sendVerificationEmail(email: string, token: string): Promise<void> {
    const link = `${this.config.appUrl}/verify-email?token=${encodeURIComponent(token)}`;
    await this.email.send({
      to: email,
      subject: 'Confirm your email address',
      text: [
        'Welcome to Property Management.',
        '',
        'Confirm your email address with the link below. It expires in 24 hours.',
        '',
        link,
      ].join('\n'),
    });
  }

  // ── Profile ───────────────────────────────────────────────────────────────

  async updateProfile(auth: AuthContext, dto: UpdateProfileDto): Promise<MeResponse> {
    await this.prisma.user.update({
      where: { id: auth.userId },
      data: {
        ...(dto.fullName !== undefined ? { fullName: dto.fullName } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone || null } : {}),
      },
    });

    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.PROFILE_UPDATED,
      entityType: 'User',
      entityId: auth.userId,
    });

    return this.buildMe(auth.userId);
  }

  // ── Shared ────────────────────────────────────────────────────────────────

  /**
   * The GET /auth/me payload. Note what is absent: passwordHash is not selected
   * at all, so it cannot be leaked by a future change to a serializer.
   */
  async buildMe(userId: string): Promise<MeResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
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
        organization: {
          select: { id: true, name: true, code: true, currency: true, timezone: true, status: true },
        },
      },
    });
    if (!user) throw new NotFoundError('User');

    const { roles, permissions } = await this.permissions.forUser(userId);

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        phone: user.phone,
        avatarUrl: user.avatarUrl,
        status: user.status,
        emailVerified: user.emailVerifiedAt !== null,
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        createdAt: user.createdAt.toISOString(),
      },
      organization: user.organization,
      roles,
      permissions,
      // Unrestricted until StaffAssignment exists (Phase 2/5).
      scopedPropertyIds: null,
    };
  }

  private async systemRoleId(name: RoleName): Promise<string> {
    const role = await this.prisma.role.findFirst({
      where: { name, organizationId: null },
      select: { id: true },
    });
    if (!role) {
      throw new Error(`System role ${name} is missing. Run "pnpm db:seed" before starting the API.`);
    }
    return role.id;
  }

  /**
   * Organization codes appear in receipt numbers, so they must be short, stable
   * and unique platform-wide. Derived from the name, with a numeric suffix when
   * the natural code is taken.
   */
  private async generateOrganizationCode(name: string): Promise<string> {
    const base =
      name
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 6) || 'ORG';

    for (let attempt = 0; attempt < 50; attempt++) {
      const candidate = attempt === 0 ? base : `${base}${attempt}`;
      const taken = await this.prisma.organization.findUnique({
        where: { code: candidate },
        select: { id: true },
      });
      if (!taken) return candidate;
    }

    return `${base}${Date.now().toString().slice(-5)}`;
  }
}

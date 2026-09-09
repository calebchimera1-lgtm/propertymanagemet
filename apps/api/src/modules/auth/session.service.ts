import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { AppConfig } from '@/config/app.config';
import { PrismaService } from '@/prisma/prisma.service';

export interface IssuedSession {
  sessionId: string;
  /** The raw cookie value. Returned once, never stored, never logged. */
  token: string;
  csrfToken: string;
  expiresAt: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** How stale lastSeenAt may get before the sliding expiry is refreshed. */
const TOUCH_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Session lifecycle (blueprint §10).
 *
 * The browser holds a 32-byte random token. The database holds only its
 * SHA-256 hash, so a stolen dump cannot be replayed as a login, and the CSRF
 * token is an HMAC binding the session id to a per-session secret.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  csrfTokenFor(sessionId: string, csrfSecret: string): string {
    return createHmac('sha256', this.config.sessionSecret)
      .update(`${sessionId}.${csrfSecret}`)
      .digest('hex');
  }

  async issue(userId: string, organizationId: string, request: Request): Promise<IssuedSession> {
    const token = randomBytes(32).toString('base64url');
    const csrfSecret = randomBytes(32).toString('base64url');
    const now = Date.now();
    const expiresAt = new Date(now + this.config.sessionTtlDays * DAY_MS);
    const absoluteExpiresAt = new Date(now + this.config.sessionAbsoluteTtlDays * DAY_MS);

    const session = await this.prisma.session.create({
      data: {
        userId,
        organizationId,
        tokenHash: this.hashToken(token),
        csrfSecret,
        ipAddress: this.ipOf(request),
        userAgent: request.get('user-agent')?.slice(0, 500),
        expiresAt,
        absoluteExpiresAt,
      },
      select: { id: true, expiresAt: true },
    });

    return {
      sessionId: session.id,
      token,
      csrfToken: this.csrfTokenFor(session.id, csrfSecret),
      expiresAt: session.expiresAt,
    };
  }

  /**
   * Looks a session up by cookie token. Returns null for anything that is not a
   * live session — missing, expired, revoked, or belonging to a user or
   * organization that is no longer active.
   */
  async resolve(token: string) {
    if (!token) return null;

    const session = await this.prisma.session.findUnique({
      where: { tokenHash: this.hashToken(token) },
      select: {
        id: true,
        userId: true,
        organizationId: true,
        csrfSecret: true,
        expiresAt: true,
        absoluteExpiresAt: true,
        revokedAt: true,
        lastSeenAt: true,
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            status: true,
            organization: { select: { id: true, status: true } },
          },
        },
      },
    });

    if (!session) return null;
    const now = new Date();
    if (session.revokedAt) return null;
    if (session.expiresAt <= now || session.absoluteExpiresAt <= now) return null;
    if (session.user.status !== 'ACTIVE') return null;
    if (session.user.organization.status !== 'ACTIVE') return null;

    return session;
  }

  /**
   * Sliding expiry, written at most once every 15 minutes so an active user is
   * not one database write per request, and never past the absolute ceiling.
   */
  async touch(session: {
    id: string;
    lastSeenAt: Date;
    expiresAt: Date;
    absoluteExpiresAt: Date;
  }): Promise<void> {
    const now = Date.now();
    if (now - session.lastSeenAt.getTime() < TOUCH_INTERVAL_MS) return;

    const proposed = now + this.config.sessionTtlDays * DAY_MS;
    const expiresAt = new Date(Math.min(proposed, session.absoluteExpiresAt.getTime()));

    await this.prisma.session
      .update({
        where: { id: session.id },
        data: { lastSeenAt: new Date(now), expiresAt },
      })
      .catch((error: unknown) => {
        // Never fail a request because the heartbeat could not be written.
        this.logger.warn(`Could not refresh session ${session.id}: ${String(error)}`);
      });
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Used by logout-everywhere, password change and password reset. */
  async revokeAllForUser(userId: string, exceptSessionId?: string): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  async listForUser(userId: string, currentSessionId: string) {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
      select: {
        id: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        lastSeenAt: true,
        expiresAt: true,
      },
    });

    return sessions.map((session) => ({ ...session, current: session.id === currentSessionId }));
  }

  /** Constant-time comparison so a CSRF token cannot be discovered by timing. */
  safeEquals(a: string, b: string): boolean {
    const left = Buffer.from(a ?? '', 'utf8');
    const right = Buffer.from(b ?? '', 'utf8');
    if (left.length !== right.length || left.length === 0) return false;
    return timingSafeEqual(left, right);
  }

  private ipOf(request: Request): string | undefined {
    const forwarded = request.get('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',')[0]?.trim() : request.ip;
    return ip?.slice(0, 64);
  }

  /** Nightly cleanup of sessions that expired more than 30 days ago. */
  async purgeExpired(): Promise<number> {
    const cutoff = new Date(Date.now() - 30 * DAY_MS);
    const result = await this.prisma.session.deleteMany({ where: { expiresAt: { lt: cutoff } } });
    return result.count;
  }
}

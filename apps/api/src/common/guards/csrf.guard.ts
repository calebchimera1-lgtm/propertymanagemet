import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES } from '@pm/types';
import type { Request } from 'express';
import { SKIP_CSRF_KEY } from '@/common/decorators';
import { DomainError } from '@/common/errors/domain.errors';
import { AppConfig } from '@/config/app.config';
import { SessionService } from '@/modules/auth/session.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Signed double-submit CSRF protection.
 *
 * The expected token is an HMAC over (sessionId, per-session secret) keyed with
 * SESSION_SECRET, so an attacker who can set a cookie on a sibling subdomain
 * still cannot forge one — the plain double-submit weakness.
 *
 * Runs after SessionAuthGuard because the expected value is derived from the
 * session. (The blueprint drew it the other way round; deriving the token from
 * the session is worth the reordering, and unauthenticated unsafe routes are
 * marked @SkipCsrf and protected by SameSite, CORS and rate limiting instead.)
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly config: AppConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<
      Request & { session?: { id: string; csrfSecret: string } }
    >();

    if (SAFE_METHODS.has(request.method)) return true;

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const session = request.session;
    if (!session) return true; // no session: SessionAuthGuard has already decided

    const expected = this.sessions.csrfTokenFor(session.id, session.csrfSecret);
    const header = (request.get('x-csrf-token') ?? '') as string;
    const cookie = (request.cookies?.[this.config.csrfCookieName] ?? '') as string;

    if (!this.sessions.safeEquals(header, expected) || !this.sessions.safeEquals(cookie, expected)) {
      throw new DomainError(
        ERROR_CODES.CSRF_TOKEN_INVALID,
        'Your session security token is missing or invalid. Refresh the page and try again.',
        403,
      );
    }

    return true;
  }
}

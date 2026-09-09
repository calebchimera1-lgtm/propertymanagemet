import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES } from '@pm/types';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '@/common/decorators';
import { UnauthenticatedError } from '@/common/errors/domain.errors';
import { AppConfig } from '@/config/app.config';
import { PermissionsService } from '@/modules/permissions/permissions.service';
import { SessionService } from '@/modules/auth/session.service';
import type { AuthContext } from '@/tenancy/tenant-context';
import { TenantContextService } from '@/tenancy/tenant-context.service';

/**
 * Layer 1 of the multi-tenant model: turn a cookie into a user, an
 * organization, a role set and a permission set — server-side, every request.
 *
 * Applied globally. A route is only reachable without a session if it is
 * explicitly marked @Public().
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly permissions: PermissionsService,
    private readonly tenant: TenantContextService,
    private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<Request & { auth?: AuthContext }>();
    const token = request.cookies?.[this.config.cookieName] as string | undefined;

    // Public routes still resolve a session when one is present, so that
    // "already signed in" behaviour works — but they never require one.
    if (!token) {
      if (isPublic) return true;
      throw new UnauthenticatedError(ERROR_CODES.UNAUTHENTICATED, 'You must sign in to continue.');
    }

    const session = await this.sessions.resolve(token);
    if (!session) {
      if (isPublic) return true;
      throw new UnauthenticatedError(
        ERROR_CODES.SESSION_EXPIRED,
        'Your session has expired. Please sign in again.',
      );
    }

    const { roles, permissions } = await this.permissions.forUser(session.userId);

    const auth: AuthContext = {
      sessionId: session.id,
      userId: session.userId,
      organizationId: session.organizationId,
      email: session.user.email,
      roles,
      permissions,
      // Property scoping needs the Property and StaffAssignment tables, which
      // arrive in Phase 2. Until then every authenticated user is unrestricted
      // within their own organization, which is already enforced above.
      scopedPropertyIds: null,
    };

    request.auth = auth;
    // Kept on the request as well as in the ALS store so the CSRF guard and the
    // exception filter can read it without depending on async context.
    (request as Request & { session?: typeof session }).session = session;
    this.tenant.setAuth(auth);

    void this.sessions.touch(session);

    return true;
  }
}

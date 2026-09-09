import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@pm/types';
import type { Request } from 'express';
import {
  AUTHENTICATED_ONLY_KEY,
  IS_PUBLIC_KEY,
  PERMISSIONS_KEY,
} from '@/common/decorators';
import { ForbiddenError } from '@/common/errors/domain.errors';
import type { AuthContext } from '@/tenancy/tenant-context';

/**
 * Deny by default.
 *
 * A route must declare @Public, @AuthenticatedOnly, or @RequirePermissions.
 * Forgetting to declare access is treated as a mistake and refused, rather than
 * quietly meaning "anyone signed in may do this".
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const request = context.switchToHttp().getRequest<Request & { auth?: AuthContext }>();
    const auth = request.auth;
    if (!auth) throw new ForbiddenError();

    if (this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_ONLY_KEY, targets)) return true;

    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, targets);
    if (!required || required.length === 0) {
      throw new ForbiddenError(
        'This action is not available. (No access policy is declared for this endpoint.)',
      );
    }

    const held = new Set<string>(auth.permissions);
    const missing = required.filter((permission) => !held.has(permission));
    if (missing.length > 0) {
      throw new ForbiddenError('You do not have permission to perform this action.');
    }

    return true;
  }
}

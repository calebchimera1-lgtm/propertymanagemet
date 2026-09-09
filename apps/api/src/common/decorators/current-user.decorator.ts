import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthContext } from '@/tenancy/tenant-context';

/**
 * Injects the authenticated caller resolved by SessionAuthGuard.
 *
 * There is no way to ask for "the user id from the request body" — that is the
 * point. Identity comes from the session or it does not come at all.
 */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthContext | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request & { auth?: AuthContext }>();
    const auth = request.auth;
    if (!auth) return undefined;
    return field ? auth[field] : auth;
  },
);

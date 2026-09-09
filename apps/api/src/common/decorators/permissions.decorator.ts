import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@pm/types';

export const PERMISSIONS_KEY = 'requiredPermissions';
export const AUTHENTICATED_ONLY_KEY = 'authenticatedOnly';

/**
 * Declares the permissions a route requires. The caller must hold ALL of them.
 *
 * An authenticated route carrying neither this decorator nor @AuthenticatedOnly
 * is rejected with 403 — forgetting to declare access must never mean "open to
 * everyone who is logged in".
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * For routes any signed-in user may call regardless of role — their own
 * profile, their own sessions, their own notifications.
 */
export const AuthenticatedOnly = () => SetMetadata(AUTHENTICATED_ONLY_KEY, true);

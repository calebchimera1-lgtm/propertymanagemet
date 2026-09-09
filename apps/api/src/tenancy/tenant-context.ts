import { AsyncLocalStorage } from 'node:async_hooks';
import type { Permission, RoleName } from '@pm/types';

/**
 * Everything the pipeline knows about who is asking, resolved by the auth guard
 * and carried for the life of the request.
 *
 * `organizationId` here is the ONLY organization id the application trusts. It
 * comes from the session row — never from a request body, query or header.
 */
export interface AuthContext {
  sessionId: string;
  userId: string;
  organizationId: string;
  email: string;
  roles: RoleName[];
  permissions: Permission[];
  /**
   * null  → unrestricted within the organization
   * []    → property-scoped user with no assignments: sees nothing (fail closed)
   * [ids] → limited to these properties
   */
  scopedPropertyIds: string[] | null;
}

/**
 * The store is created empty by TenantContextMiddleware at the very start of
 * the request and filled in by the auth guard once the session is known.
 *
 * It is a single mutable object on purpose: AsyncLocalStorage.run() must wrap
 * the whole request to be reliable, and that happens before authentication has
 * had a chance to say who the caller is.
 */
export interface RequestStore {
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
  auth?: AuthContext;
}

export const tenantStorage = new AsyncLocalStorage<RequestStore>();

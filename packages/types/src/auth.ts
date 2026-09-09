import type { Permission } from './permissions';
import type { RoleName } from './roles';

export interface OrganizationSummary {
  id: string;
  name: string;
  code: string;
  currency: string;
  timezone: string;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  avatarUrl: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'INVITED' | 'SUSPENDED';
  emailVerified: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

/**
 * Response of GET /auth/me. `permissions` is what the UI uses to hide controls
 * the user cannot use — a courtesy, never the control itself. The API re-checks
 * every permission on every request.
 */
export interface MeResponse {
  user: AuthenticatedUser;
  organization: OrganizationSummary;
  roles: RoleName[];
  permissions: Permission[];
  /**
   * null  → unrestricted within the organization (owner, manager, super admin)
   * []    → property-scoped user with no assignments: sees nothing
   * [ids] → property-scoped user limited to these properties
   */
  scopedPropertyIds: string[] | null;
}

export interface SessionSummary {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

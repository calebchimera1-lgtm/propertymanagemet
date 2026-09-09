/**
 * The six roles from the master specification.
 *
 * V1 ships working functionality for PROPERTY_OWNER, PROPERTY_MANAGER,
 * ACCOUNTANT and CARETAKER. TENANT and SUPER_ADMIN exist architecturally
 * (schema + permission matrix) but have no login surface in V1.
 */
export const ROLE_NAMES = [
  'SUPER_ADMIN',
  'PROPERTY_OWNER',
  'PROPERTY_MANAGER',
  'ACCOUNTANT',
  'CARETAKER',
  'TENANT',
] as const;

export type RoleName = (typeof ROLE_NAMES)[number];

export const ROLE_LABELS: Record<RoleName, string> = {
  SUPER_ADMIN: 'Super Admin',
  PROPERTY_OWNER: 'Property Owner',
  PROPERTY_MANAGER: 'Property Manager',
  ACCOUNTANT: 'Accountant',
  CARETAKER: 'Caretaker',
  TENANT: 'Tenant',
};

export const ROLE_DESCRIPTIONS: Record<RoleName, string> = {
  SUPER_ADMIN: 'Platform administrator. Full access within the organization.',
  PROPERTY_OWNER: 'Owns the organization. Full access including staff, settings and audit logs.',
  PROPERTY_MANAGER: 'Runs day-to-day operations across the portfolio. Cannot delete records or manage staff.',
  ACCOUNTANT: 'Records payments and expenses and runs financial reports for assigned properties.',
  CARETAKER: 'Handles maintenance and on-site operations for assigned properties. No access to money.',
  TENANT: 'Occupant. Reserved for the Version 2 tenant portal; no login in Version 1.',
};

/**
 * Roles whose data access is limited to the properties explicitly assigned to
 * them (see StaffAssignment, Phase 5). Roles outside this set see the whole
 * organization. A scoped user with no assignments sees nothing — fail closed.
 */
export const PROPERTY_SCOPED_ROLES: readonly RoleName[] = ['ACCOUNTANT', 'CARETAKER', 'TENANT'];

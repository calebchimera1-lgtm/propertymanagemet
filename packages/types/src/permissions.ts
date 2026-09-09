import type { RoleName } from './roles';

/**
 * The canonical permission catalogue. Every permission is `resource.action`.
 *
 * This array is the single source of truth: the database seed inserts exactly
 * these rows, the API's guards check against these strings, and the web app
 * hides controls based on the subset returned by GET /auth/me.
 *
 * Adding a permission here and nowhere else is enough to make it real —
 * the seed is idempotent and reconciles the table on every run.
 */
export const PERMISSIONS = [
  // Portfolio
  'properties.view',
  'properties.create',
  'properties.update',
  'properties.delete',
  'buildings.view',
  'buildings.create',
  'buildings.update',
  'buildings.delete',
  'units.view',
  'units.create',
  'units.update',
  'units.delete',
  // Occupancy
  'tenants.view',
  'tenants.create',
  'tenants.update',
  'tenants.delete',
  'leases.view',
  'leases.create',
  'leases.update',
  'leases.terminate',
  // Money
  'rent.view',
  'rent.generate',
  'payments.view',
  'payments.create',
  'payments.void',
  'receipts.view',
  'expenses.view',
  'expenses.create',
  'expenses.update',
  'expenses.delete',
  // Operations
  'maintenance.view',
  'maintenance.create',
  'maintenance.update',
  'staff.view',
  'staff.create',
  'staff.update',
  'staff.delete',
  'documents.view',
  'documents.upload',
  'documents.delete',
  // Insight & system
  'reports.view',
  'reports.export',
  'notifications.view',
  'settings.view',
  'settings.update',
  'auditlogs.view',
  'organization.update',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  'properties.view': 'View properties',
  'properties.create': 'Create properties',
  'properties.update': 'Update and archive properties',
  'properties.delete': 'Permanently delete properties',
  'buildings.view': 'View buildings',
  'buildings.create': 'Create buildings',
  'buildings.update': 'Update buildings',
  'buildings.delete': 'Permanently delete buildings',
  'units.view': 'View units',
  'units.create': 'Create units',
  'units.update': 'Update units and unit status',
  'units.delete': 'Permanently delete units',
  'tenants.view': 'View tenants and tenant profiles',
  'tenants.create': 'Create tenants',
  'tenants.update': 'Update tenants',
  'tenants.delete': 'Permanently delete tenants',
  'leases.view': 'View leases',
  'leases.create': 'Create leases',
  'leases.update': 'Update and renew leases',
  'leases.terminate': 'Terminate leases',
  'rent.view': 'View rent records and balances',
  'rent.generate': 'Generate rent records for a period',
  'payments.view': 'View payments',
  'payments.create': 'Record payments',
  'payments.void': 'Void a recorded payment',
  'receipts.view': 'View and print receipts',
  'expenses.view': 'View expenses',
  'expenses.create': 'Record expenses',
  'expenses.update': 'Update expenses',
  'expenses.delete': 'Delete expenses',
  'maintenance.view': 'View maintenance requests',
  'maintenance.create': 'Create maintenance requests',
  'maintenance.update': 'Assign, update and close maintenance requests',
  'staff.view': 'View staff',
  'staff.create': 'Create staff accounts',
  'staff.update': 'Update staff, roles and property assignments',
  'staff.delete': 'Remove staff access',
  'documents.view': 'View and download documents',
  'documents.upload': 'Upload documents',
  'documents.delete': 'Delete documents',
  'reports.view': 'View reports and the dashboard',
  'reports.export': 'Export reports',
  'notifications.view': 'View notifications',
  'settings.view': 'View organization settings',
  'settings.update': 'Change organization settings',
  'auditlogs.view': 'View the audit log',
  'organization.update': 'Update organization details',
};

const ALL: Permission[] = [...PERMISSIONS];

/**
 * Role → permission matrix (blueprint §8).
 *
 * Holding a permission answers "may this role perform this action at all".
 * It does NOT answer "on which properties" — that is the property-scope layer,
 * applied separately to every query for PROPERTY_SCOPED_ROLES.
 */
export const ROLE_PERMISSIONS: Record<RoleName, Permission[]> = {
  SUPER_ADMIN: ALL,

  PROPERTY_OWNER: ALL,

  PROPERTY_MANAGER: [
    'properties.view',
    'properties.create',
    'properties.update',
    'buildings.view',
    'buildings.create',
    'buildings.update',
    'units.view',
    'units.create',
    'units.update',
    'tenants.view',
    'tenants.create',
    'tenants.update',
    'leases.view',
    'leases.create',
    'leases.update',
    'leases.terminate',
    'rent.view',
    'rent.generate',
    'payments.view',
    'payments.create',
    'receipts.view',
    'expenses.view',
    'expenses.create',
    'expenses.update',
    'maintenance.view',
    'maintenance.create',
    'maintenance.update',
    'staff.view',
    'documents.view',
    'documents.upload',
    'documents.delete',
    'reports.view',
    'reports.export',
    'notifications.view',
    'settings.view',
  ],

  ACCOUNTANT: [
    'properties.view',
    'buildings.view',
    'units.view',
    'tenants.view',
    'leases.view',
    'rent.view',
    'rent.generate',
    'payments.view',
    'payments.create',
    'receipts.view',
    'expenses.view',
    'expenses.create',
    'expenses.update',
    'maintenance.view',
    'documents.view',
    'documents.upload',
    'reports.view',
    'reports.export',
    'notifications.view',
  ],

  CARETAKER: [
    'properties.view',
    'buildings.view',
    'units.view',
    'units.update',
    'tenants.view',
    'leases.view',
    'expenses.view',
    'expenses.create',
    'maintenance.view',
    'maintenance.create',
    'maintenance.update',
    'documents.view',
    'documents.upload',
    'notifications.view',
  ],

  // No login surface in V1. Self-scoped read permissions arrive with the
  // Version 2 tenant portal; granting them now would be dead configuration.
  TENANT: ['notifications.view'],
};

export function permissionsForRoles(roles: RoleName[]): Permission[] {
  const set = new Set<Permission>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role] ?? []) set.add(permission);
  }
  return [...set].sort();
}

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

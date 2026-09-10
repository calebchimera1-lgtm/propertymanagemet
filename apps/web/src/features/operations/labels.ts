import type {
  DocumentEntityType,
  MaintenancePriority,
  MaintenanceStatus,
  NotificationType,
  StaffStatus,
} from './types';

type BadgeVariant = 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'info' | 'outline';

export const MAINTENANCE_STATUS_LABELS: Record<MaintenanceStatus, string> = {
  PENDING: 'Pending',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const MAINTENANCE_STATUS_VARIANTS: Record<MaintenanceStatus, BadgeVariant> = {
  PENDING: 'secondary',
  ASSIGNED: 'info',
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'outline',
};

export const PRIORITY_LABELS: Record<MaintenancePriority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent',
};

/** Only URGENT is red. Colouring HIGH red too trains people to ignore both. */
export const PRIORITY_VARIANTS: Record<MaintenancePriority, BadgeVariant> = {
  LOW: 'outline',
  MEDIUM: 'secondary',
  HIGH: 'warning',
  URGENT: 'destructive',
};

/**
 * The transition table, mirrored from the API.
 *
 * The server is what enforces it — this copy exists so the UI offers only moves
 * that will succeed, rather than presenting a button that returns a 409.
 */
export const ALLOWED_TRANSITIONS: Record<MaintenanceStatus, MaintenanceStatus[]> = {
  PENDING: ['ASSIGNED', 'IN_PROGRESS', 'CANCELLED'],
  ASSIGNED: ['IN_PROGRESS', 'PENDING', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function isClosed(status: MaintenanceStatus): boolean {
  return status === 'COMPLETED' || status === 'CANCELLED';
}

export const STAFF_STATUS_LABELS: Record<StaffStatus, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  INVITED: 'Invited',
  SUSPENDED: 'Suspended',
};

export const STAFF_STATUS_VARIANTS: Record<StaffStatus, BadgeVariant> = {
  ACTIVE: 'success',
  INACTIVE: 'outline',
  INVITED: 'info',
  SUSPENDED: 'destructive',
};

export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super admin',
  PROPERTY_OWNER: 'Owner',
  PROPERTY_MANAGER: 'Manager',
  ACCOUNTANT: 'Accountant',
  CARETAKER: 'Caretaker',
  TENANT: 'Tenant',
};

export const ASSIGNABLE_ROLES = [
  'PROPERTY_OWNER',
  'PROPERTY_MANAGER',
  'ACCOUNTANT',
  'CARETAKER',
] as const;

/** Which roles are limited to assigned properties — mirrors PROPERTY_SCOPED_ROLES. */
export const SCOPED_ROLES = ['ACCOUNTANT', 'CARETAKER', 'TENANT'];

export function isScopedRole(role: string): boolean {
  return SCOPED_ROLES.includes(role);
}

export const DOCUMENT_ENTITY_LABELS: Record<DocumentEntityType, string> = {
  PROPERTY: 'Property',
  BUILDING: 'Building',
  UNIT: 'Unit',
  TENANT: 'Tenant',
  LEASE: 'Lease',
  EXPENSE: 'Expense',
  MAINTENANCE: 'Maintenance',
  ORGANIZATION: 'Organization',
};

export const NOTIFICATION_LABELS: Record<NotificationType, string> = {
  RENT_OVERDUE: 'Rent overdue',
  PAYMENT_RECORDED: 'Payment',
  LEASE_EXPIRING: 'Lease expiring',
  MAINTENANCE_UPDATED: 'Maintenance',
  SYSTEM: 'System',
};

/** Where a notification should take you, when there is somewhere to go. */
export function notificationHref(entityType: string | null, entityId: string | null): string | null {
  if (!entityType || !entityId) return null;
  switch (entityType) {
    case 'MaintenanceRequest':
      return `/maintenance/${entityId}`;
    case 'Payment':
      return '/payments';
    case 'RentRecord':
      return '/rent';
    case 'Lease':
      return `/leases/${entityId}`;
    default:
      return null;
  }
}

/** 1024-based, because that is what a file manager shows. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

/** "MAINTENANCE_STATUS_CHANGED" → "Maintenance status changed". */
export function humaniseAction(action: string): string {
  const words = action.toLowerCase().split('_');
  const first = words[0] ?? '';
  return [first.charAt(0).toUpperCase() + first.slice(1), ...words.slice(1)].join(' ');
}

export const ALLOWED_UPLOAD_EXTENSIONS = [
  '.pdf', '.jpg', '.jpeg', '.png', '.webp', '.doc', '.docx', '.xls', '.xlsx',
];

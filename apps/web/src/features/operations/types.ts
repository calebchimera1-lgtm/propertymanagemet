export type MaintenanceStatus = 'PENDING' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type MaintenancePriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type DocumentEntityType =
  | 'PROPERTY' | 'BUILDING' | 'UNIT' | 'TENANT' | 'LEASE' | 'EXPENSE' | 'MAINTENANCE' | 'ORGANIZATION';
export type NotificationType =
  | 'RENT_OVERDUE' | 'PAYMENT_RECORDED' | 'LEASE_EXPIRING' | 'MAINTENANCE_UPDATED' | 'SYSTEM';
export type StaffStatus = 'ACTIVE' | 'INACTIVE' | 'INVITED' | 'SUSPENDED';

interface Ref {
  id: string;
  name: string;
}

export interface MaintenanceUpdateEntry {
  id: string;
  note: string;
  fromStatus: MaintenanceStatus | null;
  toStatus: MaintenanceStatus | null;
  createdAt: string;
  author: { id: string; fullName: string } | null;
}

/** Costs are fixed-scale decimal strings, like every other amount in the app. */
export interface MaintenanceRequest {
  id: string;
  propertyId: string;
  buildingId: string | null;
  unitId: string | null;
  tenantId: string | null;
  title: string;
  description: string;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  assignedToId: string | null;
  estimatedCost: string | null;
  actualCost: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  property: Ref;
  building: Ref | null;
  unit: { id: string; unitNumber: string } | null;
  tenant: { id: string; fullName: string; phone: string } | null;
  assignedTo: { id: string; fullName: string; email: string } | null;
  reportedBy: { id: string; fullName: string } | null;
}

export interface MaintenanceDetail extends MaintenanceRequest {
  updates: MaintenanceUpdateEntry[];
}

export interface MaintenanceSummary {
  counts: Partial<Record<MaintenanceStatus, number>>;
  urgentOpen: number;
}

export interface StaffMember {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  status: StaffStatus;
  emailVerified: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  roles: string[];
  roleLabels: string[];
  /** null means the role covers everything; [] means assigned to nothing. */
  properties: Ref[] | null;
}

export interface StaffInvite {
  staff: StaffMember;
  invite: { url: string; expiresInDays: number; note: string };
}

export interface StaffProperties {
  unrestricted: boolean;
  properties: Ref[];
}

export interface DocumentRecord {
  id: string;
  entityType: DocumentEntityType;
  entityId: string | null;
  name: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  createdAt: string;
  uploadedBy: { id: string; fullName: string } | null;
}

export interface NotificationRecord {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  userId: string | null;
  actorEmail: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  user: { id: string; fullName: string } | null;
}

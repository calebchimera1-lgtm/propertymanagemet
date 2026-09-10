export type IdType = 'NATIONAL_ID' | 'PASSPORT' | 'ALIEN_ID' | 'MILITARY_ID' | 'OTHER';
export type LeaseStatus = 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED' | 'TERMINATED';

interface Ref {
  id: string;
  name: string;
}

export interface TenantCurrentLease {
  id: string;
  status: LeaseStatus;
  monthlyRent: string;
  endDate: string | null;
  unit: { id: string; unitNumber: string };
  property: Ref;
}

export interface Tenant {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  idType: IdType | null;
  nationalId: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  occupation: string | null;
  address: string | null;
  photoUrl: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  currentLease?: TenantCurrentLease | null;
}

export interface Lease {
  id: string;
  tenantId: string;
  propertyId: string;
  buildingId: string | null;
  unitId: string;
  startDate: string;
  endDate: string | null;
  /** Decimal strings. Formatted for display only, never parsed for arithmetic. */
  monthlyRent: string;
  securityDeposit: string;
  depositPaid: string;
  depositOutstanding: string;
  dueDay: number;
  status: LeaseStatus;
  terminatedAt: string | null;
  terminationReason: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  /** Derived by the API on read, so it is never a stale stored value. */
  daysUntilExpiry: number | null;
  tenant: { id: string; fullName: string; phone: string };
  unit: { id: string; unitNumber: string; unitType: string };
  building: Ref | null;
  property: Ref;
}

/** Money arrives as fixed-scale decimal strings; nothing here does arithmetic. */
export interface TenantFinances {
  available: boolean;
  totalCharged: string;
  totalPaid: string;
  outstanding: string;
  overdue: string;
  overdueCount: number;
  collectionRate: number;
  chargeCount: number;
}

export interface TenantRentHistoryEntry {
  id: string;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  expectedAmount: string;
  paidAmount: string;
  balance: string;
  dueDate: string;
  status: 'PENDING' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE';
  unit: { id: string; unitNumber: string };
  property: { id: string; name: string };
}

export interface TenantPaymentEntry {
  id: string;
  amount: string;
  paymentDate: string;
  paymentMethod: 'MPESA' | 'BANK' | 'CASH' | 'CHEQUE' | 'OTHER';
  reference: string | null;
  periodLabel: string | null;
  createdAt: string;
  receipt: { id: string; receiptNumber: string; voidedAt: string | null } | null;
}

export interface TenantProfile {
  tenant: Tenant;
  currentLease: LeaseHistoryEntry | null;
  leaseHistory: LeaseHistoryEntry[];
  leaseCount: number;
  finances: TenantFinances;
  rentHistory: TenantRentHistoryEntry[];
  recentPayments: TenantPaymentEntry[];
}

export interface LeaseHistoryEntry {
  id: string;
  status: LeaseStatus;
  startDate: string;
  endDate: string | null;
  monthlyRent: string;
  securityDeposit: string;
  depositPaid: string;
  dueDay: number;
  terminatedAt: string | null;
  terminationReason: string | null;
  createdAt: string;
  unit: { id: string; unitNumber: string; unitType: string };
  building: Ref | null;
  property: Ref;
}

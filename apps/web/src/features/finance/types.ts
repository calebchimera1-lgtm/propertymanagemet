export type RentStatus = 'PENDING' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE';
export type PaymentMethod = 'MPESA' | 'BANK' | 'CASH' | 'CHEQUE' | 'OTHER';
export type PaymentStatus = 'COMPLETED' | 'VOIDED';
export type ExpenseCategory =
  | 'MAINTENANCE' | 'REPAIRS' | 'SECURITY' | 'CLEANING' | 'WATER' | 'ELECTRICITY'
  | 'GARBAGE' | 'SALARIES' | 'INSURANCE' | 'TAXES' | 'MANAGEMENT' | 'CONSTRUCTION' | 'OTHER';

interface Ref { id: string; name: string }

/**
 * Every monetary field below is a fixed-scale decimal STRING, exactly as the
 * API sends it. Nothing here is ever parsed into a number for arithmetic —
 * only formatted for display.
 */
export interface RentRecord {
  id: string;
  leaseId: string;
  tenantId: string;
  propertyId: string;
  unitId: string;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  expectedAmount: string;
  paidAmount: string;
  balance: string;
  dueDate: string;
  status: RentStatus;
  daysOverdue: number;
  tenant: { id: string; fullName: string; phone: string };
  unit: { id: string; unitNumber: string };
  property: Ref;
}

export interface RentRecordDetail extends RentRecord {
  payments: {
    id: string;
    amount: string;
    paymentDate: string;
    paymentMethod: PaymentMethod;
    reference: string | null;
    createdAt: string;
    receipt: { id: string; receiptNumber: string } | null;
  }[];
}

export interface RentSummary {
  period: string;
  totals: {
    expected: string;
    collected: string;
    outstanding: string;
    overdue: string;
    collectionRate: number;
  };
  counts: Partial<Record<RentStatus, number>>;
  recordCount: number;
}

export interface Payment {
  id: string;
  tenantId: string;
  propertyId: string;
  unitId: string;
  leaseId: string;
  rentRecordId: string;
  amount: string;
  paymentDate: string;
  paymentMethod: PaymentMethod;
  reference: string | null;
  periodLabel: string | null;
  notes: string | null;
  status: PaymentStatus;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
  tenant: { id: string; fullName: string; phone: string };
  unit: { id: string; unitNumber: string };
  property: Ref;
  receipt: { id: string; receiptNumber: string; voidedAt: string | null } | null;
}

export interface Receipt {
  id: string;
  receiptNumber: string;
  paymentId: string;
  amount: string;
  paymentMethod: PaymentMethod;
  reference: string | null;
  paymentDate: string;
  periodLabel: string | null;
  voidedAt: string | null;
  createdAt: string;
  tenant: { id: string; fullName: string; phone: string; email: string | null };
  unit: { id: string; unitNumber: string };
  property: Ref;
  organization?: {
    name: string;
    code: string;
    email: string | null;
    phone: string | null;
    addressLine: string | null;
    city: string | null;
    currency: string;
  };
}

export interface Expense {
  id: string;
  propertyId: string;
  buildingId: string | null;
  unitId: string | null;
  category: ExpenseCategory;
  description: string;
  amount: string;
  expenseDate: string;
  paymentMethod: PaymentMethod | null;
  vendor: string | null;
  reference: string | null;
  createdAt: string;
  property: Ref;
  building: Ref | null;
  unit: { id: string; unitNumber: string } | null;
}

export interface ExpenseSummary {
  total: string;
  count: number;
  byCategory: { category: ExpenseCategory; total: string; count: number }[];
}

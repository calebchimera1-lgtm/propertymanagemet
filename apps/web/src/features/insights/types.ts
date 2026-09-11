/** Every money field is a fixed-scale decimal string, as it leaves the API. */
export interface DashboardSummary {
  period: string;
  portfolio: {
    properties: number;
    buildings: number;
    units: {
      total: number;
      occupied: number;
      vacant: number;
      maintenance: number;
      reserved: number;
      unavailable: number;
    };
    occupancyRate: number;
    /** Percentage points against last month. Null when there is nothing to compare. */
    occupancyDelta: number | null;
  };
  money: {
    expected: string;
    collected: string;
    outstanding: string;
    overdue: string;
    expenses: string;
    netIncome: string;
    collectionRate: number;
    chargeCount: number;
    paymentCount: number;
    expenseCount: number;
  };
  /** True when the caller only sees their assigned properties. */
  scoped: boolean;
}

export interface MonthPoint {
  period: string;
  expected: string;
  collected: string;
  expenses: string;
  netIncome: string;
  collectionRate: number;
  occupancyRate: number;
}

export interface DashboardCharts {
  months: MonthPoint[];
  expensesByCategory: { category: string; total: string; count: number }[];
  propertyPerformance: {
    id: string;
    name: string;
    collected: string;
    expenses: string;
    netIncome: string;
  }[];
  scoped: boolean;
}

export interface Worklists {
  overdueRent: {
    id: string;
    periodLabel: string;
    balance: string;
    dueDate: string;
    daysOverdue: number;
    tenant: { id: string; fullName: string };
    unit: { id: string; unitNumber: string };
    property: { id: string; name: string };
  }[];
  expiringLeases: {
    id: string;
    endDate: string | null;
    monthlyRent: string;
    daysRemaining: number | null;
    tenant: { id: string; fullName: string };
    unit: { id: string; unitNumber: string };
    property: { id: string; name: string };
  }[];
  openMaintenance: {
    id: string;
    title: string;
    priority: string;
    status: string;
    createdAt: string;
    property: { id: string; name: string };
    unit: { id: string; unitNumber: string } | null;
  }[];
  recentPayments: {
    id: string;
    amount: string;
    paymentDate: string;
    paymentMethod: string;
    periodLabel: string | null;
    tenant: { id: string; fullName: string };
    unit: { id: string; unitNumber: string };
    receipt: { id: string; receiptNumber: string } | null;
  }[];
  scoped: boolean;
}

export type ColumnFormat = 'text' | 'money' | 'date' | 'number' | 'percent';

export interface ReportColumn {
  key: string;
  label: string;
  format?: ColumnFormat;
  numeric?: boolean;
}

export type ReportRow = Record<string, string | number | null>;

export interface ReportCatalogueEntry {
  key: string;
  title: string;
  description: string;
  /** The filters this report actually honours; the UI shows only these. */
  filters: string[];
}

export interface ReportResult {
  report: { key: string; title: string; description: string };
  columns: ReportColumn[];
  rows: ReportRow[];
  totals: Record<string, string | number>;
  meta: { total: number; page: number; limit: number; [key: string]: unknown };
  scoped: boolean;
}

import {
  BarChart3,
  Blocks,
  Building2,
  CircleDollarSign,
  DoorClosed,
  FileText,
  FolderOpen,
  Home,
  Receipt,
  Settings,
  UserSquare2,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react';
import type { Permission } from '@pm/types';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Hidden unless the user holds this permission. */
  permission?: Permission;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Navigation grows one phase at a time.
 *
 * Only routes that actually exist are listed: a sidebar full of links to
 * unbuilt screens would look like a working product and behave like a
 * prototype. Portfolio, Occupancy, Finance, Operations and Insights groups are
 * added by the phases that build them (see docs/BLUEPRINT.md §21).
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ label: 'Dashboard', href: '/dashboard', icon: Home }],
  },
  {
    label: 'Portfolio',
    items: [
      { label: 'Properties', href: '/properties', icon: Building2, permission: 'properties.view' },
      { label: 'Buildings', href: '/buildings', icon: Blocks, permission: 'buildings.view' },
      { label: 'Units', href: '/units', icon: DoorClosed, permission: 'units.view' },
    ],
  },
  {
    label: 'Occupancy',
    items: [
      { label: 'Tenants', href: '/tenants', icon: UserSquare2, permission: 'tenants.view' },
      { label: 'Leases', href: '/leases', icon: FileText, permission: 'leases.view' },
    ],
  },
  {
    label: 'Finance',
    items: [
      { label: 'Rent', href: '/rent', icon: Wallet, permission: 'rent.view' },
      { label: 'Payments', href: '/payments', icon: CircleDollarSign, permission: 'payments.view' },
      { label: 'Receipts', href: '/receipts', icon: Receipt, permission: 'receipts.view' },
      { label: 'Expenses', href: '/expenses', icon: FileText, permission: 'expenses.view' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Maintenance', href: '/maintenance', icon: Wrench, permission: 'maintenance.view' },
      { label: 'Staff', href: '/staff', icon: Users, permission: 'staff.view' },
      { label: 'Documents', href: '/documents', icon: FolderOpen, permission: 'documents.view' },
    ],
  },
  {
    label: 'Organization',
    items: [{ label: 'Settings', href: '/settings', icon: Settings, permission: 'settings.view' }],
  },
];

/** Referenced by the dashboard's roadmap panel so the two never drift apart. */
export const UPCOMING_SECTIONS = [
  { label: 'Dashboard metrics and charts', icon: BarChart3, phase: 'Phase 6' },
  { label: 'The nine reports, with CSV and PDF export', icon: FileText, phase: 'Phase 6' },
  { label: 'Security hardening and accessibility pass', icon: Receipt, phase: 'Phase 7' },
];

import {
  Blocks,
  Building2,
  CircleDollarSign,
  DoorClosed,
  FileText,
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
    label: 'Organization',
    items: [
      { label: 'Users', href: '/users', icon: Users, permission: 'staff.view' },
      { label: 'Settings', href: '/settings', icon: Settings, permission: 'settings.view' },
    ],
  },
];

/** Referenced by the dashboard's roadmap panel so the two never drift apart. */
export const UPCOMING_SECTIONS = [
  { label: 'Maintenance requests and work orders', icon: Wrench, phase: 'Phase 5' },
  { label: 'Documents and file uploads', icon: FileText, phase: 'Phase 5' },
  { label: 'Dashboard metrics and reports', icon: Receipt, phase: 'Phase 6' },
];

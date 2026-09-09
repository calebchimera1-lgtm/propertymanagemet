import {
  Building2,
  ClipboardList,
  FileText,
  Home,
  Receipt,
  Settings,
  Users,
  Wallet,
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
    label: 'Organization',
    items: [
      { label: 'Users', href: '/users', icon: Users, permission: 'staff.view' },
      { label: 'Settings', href: '/settings', icon: Settings, permission: 'settings.view' },
    ],
  },
];

/** Referenced by the dashboard's roadmap panel so the two never drift apart. */
export const UPCOMING_SECTIONS = [
  { label: 'Properties, buildings and units', icon: Building2, phase: 'Phase 2' },
  { label: 'Tenants and leases', icon: ClipboardList, phase: 'Phase 3' },
  { label: 'Rent, payments and receipts', icon: Wallet, phase: 'Phase 4' },
  { label: 'Expenses and maintenance', icon: Receipt, phase: 'Phase 4-5' },
  { label: 'Dashboard metrics and reports', icon: FileText, phase: 'Phase 6' },
];

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Building2 } from 'lucide-react';
import type { Permission } from '@pm/types';
import { useSession } from '@/features/auth/use-session';
import { cn } from '@/lib/utils';
import { NAV_GROUPS } from './nav-items';

interface SidebarProps {
  onNavigate?: () => void;
}

export function SidebarNav({ onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const { can, me } = useSession();

  const isVisible = (permission?: Permission) => !permission || can(permission);

  return (
    <nav className="flex h-full flex-col gap-6" aria-label="Main navigation">
      <Link
        href="/dashboard"
        className="flex items-center gap-2.5 px-2"
        onClick={onNavigate}
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Building2 className="h-5 w-5" aria-hidden />
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-sm font-semibold">{me?.organization.name ?? 'Property Manager'}</span>
          <span className="text-xs text-muted-foreground">{me?.organization.code}</span>
        </span>
      </Link>

      <div className="flex-1 space-y-6 overflow-y-auto">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((item) => isVisible(item.permission));
          if (items.length === 0) return null;

          return (
            <div key={group.label}>
              <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
              <ul className="space-y-1">
                {items.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                          active
                            ? 'bg-primary/10 text-primary'
                            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                        )}
                      >
                        <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      <p className="px-3 text-xs text-muted-foreground">Version 1 · Phase 1</p>
    </nav>
  );
}

/** Fixed sidebar for desktop. On mobile the same nav renders inside a sheet. */
export function Sidebar() {
  return (
    <aside className="no-print hidden w-64 shrink-0 border-r bg-card px-3 py-4 lg:block">
      <SidebarNav />
    </aside>
  );
}

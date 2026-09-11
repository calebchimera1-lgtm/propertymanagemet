'use client';

import { AlertTriangle, CalendarClock, Receipt, Wrench } from 'lucide-react';
import Link from 'next/link';
import type * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  MAINTENANCE_STATUS_LABELS,
  PRIORITY_LABELS,
  PRIORITY_VARIANTS,
} from '@/features/operations/labels';
import type { MaintenancePriority, MaintenanceStatus } from '@/features/operations/types';
import { formatDate, formatMoney } from '@/lib/utils';
import type { Worklists } from '../types';

/**
 * The four worklists: what needs doing, rather than what happened.
 *
 * Each row links straight to the action it implies — an overdue charge goes to
 * the rent roll, an expiring lease to the lease. A list you have to navigate
 * away from and search for is a list nobody uses twice.
 */
function Panel({
  title,
  description,
  icon: Icon,
  href,
  hrefLabel,
  loading,
  empty,
  emptyMessage,
  children,
}: {
  title: string;
  description: string;
  icon: React.ElementType;
  href: string;
  hrefLabel: string;
  loading?: boolean;
  empty: boolean;
  emptyMessage: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 pb-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
            {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <Link href={href} className="shrink-0 text-sm text-primary hover:underline">
          {hrefLabel}
        </Link>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : empty ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>
        ) : (
          <ul className="divide-y text-sm">{children}</ul>
        )}
      </CardContent>
    </Card>
  );
}

export function OverdueRentPanel({
  rows,
  currency,
  loading,
}: {
  rows: Worklists['overdueRent'];
  currency: string;
  loading?: boolean;
}) {
  return (
    <Panel
      title="Overdue rent"
      description="The ten largest balances past their due date."
      icon={AlertTriangle}
      href="/rent"
      hrefLabel="Rent roll"
      loading={loading}
      empty={rows.length === 0}
      emptyMessage="Nothing is overdue."
    >
      {rows.map((row) => (
        <li key={row.id} className="flex items-center justify-between gap-3 py-2.5">
          <div className="min-w-0">
            <Link href="/rent" className="truncate font-medium hover:underline">
              {row.tenant.fullName}
            </Link>
            <div className="truncate text-xs text-muted-foreground">
              {row.unit.unitNumber} · {row.property.name} · {row.periodLabel}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="font-medium tabular-nums">{formatMoney(row.balance, currency)}</div>
            <div className="text-xs text-destructive">{row.daysOverdue} days late</div>
          </div>
        </li>
      ))}
    </Panel>
  );
}

export function ExpiringLeasesPanel({
  rows,
  currency,
  loading,
}: {
  rows: Worklists['expiringLeases'];
  currency: string;
  loading?: boolean;
}) {
  return (
    <Panel
      title="Leases expiring"
      description="Ending within sixty days."
      icon={CalendarClock}
      href="/leases"
      hrefLabel="All leases"
      loading={loading}
      empty={rows.length === 0}
      emptyMessage="Nothing expires in the next sixty days."
    >
      {rows.map((row) => (
        <li key={row.id} className="flex items-center justify-between gap-3 py-2.5">
          <div className="min-w-0">
            <Link href={`/leases/${row.id}`} className="truncate font-medium hover:underline">
              {row.tenant.fullName}
            </Link>
            <div className="truncate text-xs text-muted-foreground">
              {row.unit.unitNumber} · {row.property.name}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="tabular-nums">{formatDate(row.endDate)}</div>
            <div className="text-xs text-muted-foreground">
              {row.daysRemaining} day{row.daysRemaining === 1 ? '' : 's'} left
            </div>
          </div>
        </li>
      ))}
    </Panel>
  );
}

export function OpenMaintenancePanel({
  rows,
  loading,
}: {
  rows: Worklists['openMaintenance'];
  loading?: boolean;
}) {
  return (
    <Panel
      title="Open maintenance"
      description="Urgent first."
      icon={Wrench}
      href="/maintenance"
      hrefLabel="All jobs"
      loading={loading}
      empty={rows.length === 0}
      emptyMessage="Nothing outstanding."
    >
      {rows.map((row) => (
        <li key={row.id} className="flex items-center justify-between gap-3 py-2.5">
          <div className="min-w-0">
            <Link href={`/maintenance/${row.id}`} className="truncate font-medium hover:underline">
              {row.title}
            </Link>
            <div className="truncate text-xs text-muted-foreground">
              {row.property.name}
              {row.unit ? ` · ${row.unit.unitNumber}` : ''}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Badge variant={PRIORITY_VARIANTS[row.priority as MaintenancePriority]}>
              {PRIORITY_LABELS[row.priority as MaintenancePriority]}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {MAINTENANCE_STATUS_LABELS[row.status as MaintenanceStatus]}
            </span>
          </div>
        </li>
      ))}
    </Panel>
  );
}

export function RecentPaymentsPanel({
  rows,
  currency,
  loading,
}: {
  rows: Worklists['recentPayments'];
  currency: string;
  loading?: boolean;
}) {
  return (
    <Panel
      title="Recent payments"
      description="The last ten received."
      icon={Receipt}
      href="/payments"
      hrefLabel="All payments"
      loading={loading}
      empty={rows.length === 0}
      emptyMessage="No payments recorded yet."
    >
      {rows.map((row) => (
        <li key={row.id} className="flex items-center justify-between gap-3 py-2.5">
          <div className="min-w-0">
            <div className="truncate font-medium">{row.tenant.fullName}</div>
            <div className="truncate text-xs text-muted-foreground">
              {row.unit.unitNumber} · {formatDate(row.paymentDate)}
              {row.periodLabel ? ` · ${row.periodLabel}` : ''}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="font-medium tabular-nums">{formatMoney(row.amount, currency)}</div>
            {row.receipt ? (
              <Link
                href={`/receipts/${row.receipt.id}`}
                className="font-mono text-xs text-primary hover:underline"
              >
                {row.receipt.receiptNumber}
              </Link>
            ) : null}
          </div>
        </li>
      ))}
    </Panel>
  );
}

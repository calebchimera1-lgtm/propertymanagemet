'use client';

import { CalendarClock, FileText, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/states';
import { type Column, DataTable } from '@/components/data-table/data-table';
import { DataTablePagination } from '@/components/data-table/pagination';
import { DataTableToolbar, FilterSelect } from '@/components/data-table/toolbar';
import { useTableParams } from '@/components/data-table/use-table-params';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSession } from '@/features/auth/use-session';
import { LeaseFormDialog } from '@/features/occupancy/components/lease-form-dialog';
import {
  LEASE_STATUS_LABELS,
  LEASE_STATUS_VARIANTS,
  expiryLabel,
} from '@/features/occupancy/labels';
import { useExpiringLeases, useLeases } from '@/features/occupancy/queries';
import type { Lease } from '@/features/occupancy/types';
import { useProperties } from '@/features/portfolio/queries';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/utils';

export default function LeasesPage() {
  const router = useRouter();
  const { can, me } = useSession();
  const [createOpen, setCreateOpen] = useState(false);

  const table = useTableParams({ sortBy: 'startDate', sortOrder: 'desc' });
  const { data, isLoading, isError, error, refetch } = useLeases(table.query);
  const properties = useProperties({ limit: 100, sortBy: 'name', sortOrder: 'asc' });
  const expiring = useExpiringLeases(60);

  const currency = me?.organization.currency ?? 'KES';
  const hasFilters = Boolean(table.search || table.filters.status || table.filters.propertyId);

  const columns: Column<Lease>[] = [
    {
      header: 'Tenant',
      cell: (lease) => (
        <div>
          <div className="font-medium">{lease.tenant.fullName}</div>
          <div className="text-xs text-muted-foreground">{lease.tenant.phone}</div>
        </div>
      ),
    },
    {
      header: 'Unit',
      cell: (lease) => (
        <div>
          <div>{lease.unit.unitNumber}</div>
          <div className="text-xs text-muted-foreground">{lease.property.name}</div>
        </div>
      ),
    },
    {
      header: 'Rent',
      sortKey: 'monthlyRent',
      cell: (lease) => (
        <span className="tabular-nums">{formatMoney(lease.monthlyRent, currency)}</span>
      ),
    },
    {
      header: 'Term',
      sortKey: 'endDate',
      cell: (lease) => (
        <div>
          <div>{formatDate(lease.startDate)}</div>
          <div className="text-xs text-muted-foreground">
            {lease.endDate ? expiryLabel(lease.daysUntilExpiry) : 'Open-ended'}
          </div>
        </div>
      ),
    },
    {
      header: 'Status',
      cell: (lease) => (
        <Badge variant={LEASE_STATUS_VARIANTS[lease.status]}>
          {LEASE_STATUS_LABELS[lease.status]}
        </Badge>
      ),
    },
  ];

  const expiringCount = expiring.data?.data.length ?? 0;

  return (
    <>
      <PageHeader
        title="Leases"
        description="Every agreement putting a tenant in a unit, live and historical."
        actions={
          can('leases.create') ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              Create lease
            </Button>
          ) : null
        }
      />

      {expiringCount > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-info" aria-hidden />
              <CardTitle className="text-base">
                {expiringCount} lease{expiringCount === 1 ? '' : 's'} ending in the next 60 days
              </CardTitle>
            </div>
            <CardDescription>Renew or plan a move-out before the date passes.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {expiring.data?.data.slice(0, 6).map((lease) => (
              <Button key={lease.id} asChild variant="outline" size="sm">
                <Link href={`/leases/${lease.id}`}>
                  {lease.tenant.fullName} · {lease.unit.unitNumber} ·{' '}
                  {expiryLabel(lease.daysUntilExpiry)}
                </Link>
              </Button>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <DataTableToolbar
        search={table.search}
        onSearchChange={table.onSearchChange}
        searchPlaceholder="Search tenant or unit"
        hasFilters={hasFilters}
        onClear={() => {
          table.onSearchChange('');
          table.setFilter('status', undefined);
          table.setFilter('propertyId', undefined);
        }}
      >
        <FilterSelect
          label="Status"
          value={table.filters.status}
          onChange={(value) => table.setFilter('status', value)}
          options={(Object.keys(LEASE_STATUS_LABELS) as (keyof typeof LEASE_STATUS_LABELS)[]).map(
            (value) => ({ value, label: LEASE_STATUS_LABELS[value] }),
          )}
          allLabel="All statuses"
        />
        <FilterSelect
          label="Property"
          value={table.filters.propertyId}
          onChange={(value) => table.setFilter('propertyId', value)}
          options={(properties.data?.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
          allLabel="All properties"
        />
      </DataTableToolbar>

      {isLoading ? (
        <TableSkeleton rows={5} columns={5} />
      ) : isError ? (
        <ErrorState
          description={error instanceof ApiError ? error.message : 'Leases could not be loaded.'}
          onRetry={() => void refetch()}
        />
      ) : !data || data.data.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={hasFilters ? 'No leases match these filters' : 'No leases yet'}
          description={
            hasFilters
              ? 'Try a different search or clear the filters.'
              : 'Create a lease to move a tenant into a vacant unit.'
          }
          action={
            can('leases.create') && !hasFilters ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden />
                Create lease
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <DataTable
            rows={data.data}
            columns={columns}
            rowKey={(lease) => lease.id}
            onRowClick={(lease) => router.push(`/leases/${lease.id}`)}
            sortBy={table.sortBy}
            sortOrder={table.sortOrder}
            onSort={table.toggleSort}
          />
          <DataTablePagination meta={data.meta} onPageChange={table.setPage} noun="lease" />
        </>
      )}

      <LeaseFormDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

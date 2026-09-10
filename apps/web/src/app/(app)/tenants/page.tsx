'use client';

import { Plus, Users } from 'lucide-react';
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
import { useSession } from '@/features/auth/use-session';
import { TenantFormDialog } from '@/features/occupancy/components/tenant-form-dialog';
import { LEASE_STATUS_LABELS, LEASE_STATUS_VARIANTS } from '@/features/occupancy/labels';
import { useTenants } from '@/features/occupancy/queries';
import type { Tenant } from '@/features/occupancy/types';
import { useProperties } from '@/features/portfolio/queries';
import { ApiError } from '@/lib/api-client';
import { formatMoney } from '@/lib/utils';

export default function TenantsPage() {
  const router = useRouter();
  const { can, me } = useSession();
  const [createOpen, setCreateOpen] = useState(false);

  const table = useTableParams({ sortBy: 'fullName', sortOrder: 'asc' });
  const { data, isLoading, isError, error, refetch } = useTenants(table.query);
  const properties = useProperties({ limit: 100, sortBy: 'name', sortOrder: 'asc' });

  const currency = me?.organization.currency ?? 'KES';
  const hasFilters = Boolean(
    table.search || table.filters.hasActiveLease || table.filters.propertyId,
  );

  const columns: Column<Tenant>[] = [
    {
      header: 'Tenant',
      sortKey: 'fullName',
      cell: (tenant) => (
        <div>
          <div className="font-medium">{tenant.fullName}</div>
          <div className="text-xs text-muted-foreground">{tenant.phone}</div>
        </div>
      ),
    },
    {
      header: 'Unit',
      cell: (tenant) =>
        tenant.currentLease ? (
          <div>
            <div>{tenant.currentLease.unit.unitNumber}</div>
            <div className="text-xs text-muted-foreground">{tenant.currentLease.property.name}</div>
          </div>
        ) : (
          <span className="text-muted-foreground">Not housed</span>
        ),
    },
    {
      header: 'Rent',
      cell: (tenant) =>
        tenant.currentLease ? (
          <span className="tabular-nums">
            {formatMoney(tenant.currentLease.monthlyRent, currency)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      header: 'Lease',
      cell: (tenant) =>
        tenant.currentLease ? (
          <Badge variant={LEASE_STATUS_VARIANTS[tenant.currentLease.status]}>
            {LEASE_STATUS_LABELS[tenant.currentLease.status]}
          </Badge>
        ) : (
          <Badge variant="outline">No lease</Badge>
        ),
    },
    {
      header: 'Status',
      desktopOnly: true,
      cell: (tenant) => (
        <Badge variant={tenant.isActive ? 'success' : 'secondary'}>
          {tenant.isActive ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Tenants"
        description="People renting, or about to rent, your units. Assigning a unit happens through a lease."
        actions={
          can('tenants.create') ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              Add tenant
            </Button>
          ) : null
        }
      />

      <DataTableToolbar
        search={table.search}
        onSearchChange={table.onSearchChange}
        searchPlaceholder="Search name, phone, email or ID"
        hasFilters={hasFilters}
        onClear={() => {
          table.onSearchChange('');
          table.setFilter('hasActiveLease', undefined);
          table.setFilter('propertyId', undefined);
        }}
      >
        <FilterSelect
          label="Housing"
          value={table.filters.hasActiveLease}
          onChange={(value) => table.setFilter('hasActiveLease', value)}
          options={[
            { value: 'true', label: 'Has a lease' },
            { value: 'false', label: 'Not housed' },
          ]}
          allLabel="Everyone"
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
          description={error instanceof ApiError ? error.message : 'Tenants could not be loaded.'}
          requestId={error instanceof ApiError ? error.requestId : undefined}
          onRetry={() => void refetch()}
        />
      ) : !data || data.data.length === 0 ? (
        <EmptyState
          icon={Users}
          title={hasFilters ? 'No tenants match these filters' : 'No tenants yet'}
          description={
            hasFilters
              ? 'Try a different search or clear the filters.'
              : 'Add the people renting your units. You can create their lease straight afterwards.'
          }
          action={
            can('tenants.create') && !hasFilters ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden />
                Add tenant
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <DataTable
            rows={data.data}
            columns={columns}
            rowKey={(tenant) => tenant.id}
            onRowClick={(tenant) => router.push(`/tenants/${tenant.id}`)}
            sortBy={table.sortBy}
            sortOrder={table.sortOrder}
            onSort={table.toggleSort}
          />
          <DataTablePagination meta={data.meta} onPageChange={table.setPage} noun="tenant" />
        </>
      )}

      <TenantFormDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

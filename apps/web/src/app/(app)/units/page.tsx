'use client';

import { DoorClosed, Plus } from 'lucide-react';
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
import { UnitFormDialog } from '@/features/portfolio/components/unit-form-dialog';
import {
  UNIT_STATUS_LABELS,
  UNIT_STATUS_VARIANTS,
  UNIT_TYPE_LABELS,
  selectOptions,
} from '@/features/portfolio/labels';
import { useProperties, useUnits } from '@/features/portfolio/queries';
import type { Unit } from '@/features/portfolio/types';
import { ApiError } from '@/lib/api-client';
import { formatMoney } from '@/lib/utils';

export default function UnitsPage() {
  const router = useRouter();
  const { can, me } = useSession();
  const [createOpen, setCreateOpen] = useState(false);

  const table = useTableParams({ sortBy: 'unitNumber', sortOrder: 'asc' });
  const { data, isLoading, isError, error, refetch } = useUnits(table.query);
  const properties = useProperties({ limit: 100, sortBy: 'name', sortOrder: 'asc' });

  const currency = me?.organization.currency ?? 'KES';
  const hasFilters = Boolean(
    table.search || table.filters.propertyId || table.filters.status || table.filters.unitType,
  );

  const columns: Column<Unit>[] = [
    {
      header: 'Unit',
      sortKey: 'unitNumber',
      cell: (unit) => (
        <div>
          <div className="font-medium">{unit.unitNumber}</div>
          <div className="text-xs text-muted-foreground">
            {unit.property.name}
            {unit.building ? ` · ${unit.building.name}` : ''}
          </div>
        </div>
      ),
    },
    { header: 'Type', cell: (unit) => UNIT_TYPE_LABELS[unit.unitType] },
    {
      header: 'Beds / baths',
      desktopOnly: true,
      cell: (unit) => `${unit.bedrooms ?? '—'} / ${unit.bathrooms ?? '—'}`,
    },
    {
      header: 'Rent',
      sortKey: 'monthlyRent',
      cell: (unit) => (
        <span className="tabular-nums">{formatMoney(unit.monthlyRent, currency)}</span>
      ),
    },
    {
      header: 'Status',
      cell: (unit) => (
        <Badge variant={UNIT_STATUS_VARIANTS[unit.status]}>{UNIT_STATUS_LABELS[unit.status]}</Badge>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Units"
        description="Every rentable unit across your portfolio, with its monthly rent."
        actions={
          can('units.create') ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              Add unit
            </Button>
          ) : null
        }
      />

      <DataTableToolbar
        search={table.search}
        onSearchChange={table.onSearchChange}
        searchPlaceholder="Search unit number"
        hasFilters={hasFilters}
        onClear={() => {
          table.onSearchChange('');
          table.setFilter('propertyId', undefined);
          table.setFilter('status', undefined);
          table.setFilter('unitType', undefined);
        }}
      >
        <FilterSelect
          label="Property"
          value={table.filters.propertyId}
          onChange={(value) => table.setFilter('propertyId', value)}
          options={(properties.data?.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
          allLabel="All properties"
        />
        <FilterSelect
          label="Status"
          value={table.filters.status}
          onChange={(value) => table.setFilter('status', value)}
          options={selectOptions(UNIT_STATUS_LABELS)}
          allLabel="All statuses"
        />
        <FilterSelect
          label="Type"
          value={table.filters.unitType}
          onChange={(value) => table.setFilter('unitType', value)}
          options={selectOptions(UNIT_TYPE_LABELS)}
          allLabel="All types"
        />
      </DataTableToolbar>

      {isLoading ? (
        <TableSkeleton rows={6} columns={5} />
      ) : isError ? (
        <ErrorState
          description={error instanceof ApiError ? error.message : 'Units could not be loaded.'}
          onRetry={() => void refetch()}
        />
      ) : !data || data.data.length === 0 ? (
        <EmptyState
          icon={DoorClosed}
          title={hasFilters ? 'No units match these filters' : 'No units yet'}
          description={
            hasFilters
              ? 'Try a different search or clear the filters.'
              : 'Add units to a property to start tracking rent and occupancy.'
          }
          action={
            can('units.create') && !hasFilters ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden />
                Add unit
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <DataTable
            rows={data.data}
            columns={columns}
            rowKey={(unit) => unit.id}
            onRowClick={(unit) => router.push(`/units/${unit.id}`)}
            sortBy={table.sortBy}
            sortOrder={table.sortOrder}
            onSort={table.toggleSort}
          />
          <DataTablePagination meta={data.meta} onPageChange={table.setPage} noun="unit" />
        </>
      )}

      <UnitFormDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

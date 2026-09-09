'use client';

import { Blocks, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/states';
import { type Column, DataTable } from '@/components/data-table/data-table';
import { DataTablePagination } from '@/components/data-table/pagination';
import { DataTableToolbar, FilterSelect } from '@/components/data-table/toolbar';
import { useTableParams } from '@/components/data-table/use-table-params';
import { Button } from '@/components/ui/button';
import { useSession } from '@/features/auth/use-session';
import { BuildingFormDialog } from '@/features/portfolio/components/building-form-dialog';
import { useBuildings, useProperties } from '@/features/portfolio/queries';
import type { Building } from '@/features/portfolio/types';
import { ApiError } from '@/lib/api-client';

export default function BuildingsPage() {
  const router = useRouter();
  const { can } = useSession();
  const [createOpen, setCreateOpen] = useState(false);

  const table = useTableParams({ sortBy: 'name', sortOrder: 'asc' });
  const { data, isLoading, isError, error, refetch } = useBuildings(table.query);
  const properties = useProperties({ limit: 100, sortBy: 'name', sortOrder: 'asc' });

  const hasFilters = Boolean(table.search || table.filters.propertyId);

  const columns: Column<Building>[] = [
    { header: 'Name', sortKey: 'name', cell: (b) => <span className="font-medium">{b.name}</span> },
    { header: 'Property', cell: (b) => b.property.name },
    { header: 'Floors', sortKey: 'floors', cell: (b) => b.floors ?? '—' },
    { header: 'Units', cell: (b) => b.unitCount },
  ];

  return (
    <>
      <PageHeader
        title="Buildings"
        description="Blocks within your properties. A property with a single structure does not need one."
        actions={
          can('buildings.create') ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              Add building
            </Button>
          ) : null
        }
      />

      <DataTableToolbar
        search={table.search}
        onSearchChange={table.onSearchChange}
        searchPlaceholder="Search building name"
        hasFilters={hasFilters}
        onClear={() => {
          table.onSearchChange('');
          table.setFilter('propertyId', undefined);
        }}
      >
        <FilterSelect
          label="Property"
          value={table.filters.propertyId}
          onChange={(value) => table.setFilter('propertyId', value)}
          options={(properties.data?.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
          allLabel="All properties"
        />
      </DataTableToolbar>

      {isLoading ? (
        <TableSkeleton rows={4} columns={4} />
      ) : isError ? (
        <ErrorState
          description={error instanceof ApiError ? error.message : 'Buildings could not be loaded.'}
          onRetry={() => void refetch()}
        />
      ) : !data || data.data.length === 0 ? (
        <EmptyState
          icon={Blocks}
          title={hasFilters ? 'No buildings match these filters' : 'No buildings yet'}
          description={
            hasFilters
              ? 'Try a different search or clear the filters.'
              : 'Add a block if one of your properties has more than one structure.'
          }
          action={
            can('buildings.create') && !hasFilters ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden />
                Add building
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <DataTable
            rows={data.data}
            columns={columns}
            rowKey={(b) => b.id}
            onRowClick={(b) => router.push(`/buildings/${b.id}`)}
            sortBy={table.sortBy}
            sortOrder={table.sortOrder}
            onSort={table.toggleSort}
          />
          <DataTablePagination meta={data.meta} onPageChange={table.setPage} noun="building" />
        </>
      )}

      <BuildingFormDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

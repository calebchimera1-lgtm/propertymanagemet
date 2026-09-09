'use client';

import { Building2, Plus } from 'lucide-react';
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
import { PropertyFormDialog } from '@/features/portfolio/components/property-form-dialog';
import {
  PROPERTY_STATUS_LABELS,
  PROPERTY_STATUS_VARIANTS,
  PROPERTY_TYPE_LABELS,
  selectOptions,
} from '@/features/portfolio/labels';
import { useProperties } from '@/features/portfolio/queries';
import type { Property } from '@/features/portfolio/types';
import { useSession } from '@/features/auth/use-session';
import { ApiError } from '@/lib/api-client';

export default function PropertiesPage() {
  const router = useRouter();
  const { can } = useSession();
  const [createOpen, setCreateOpen] = useState(false);

  const table = useTableParams({ sortBy: 'name', sortOrder: 'asc' });
  const { data, isLoading, isError, error, refetch } = useProperties(table.query);

  const hasFilters = Boolean(table.search || table.filters.propertyType || table.filters.status);

  const columns: Column<Property>[] = [
    {
      header: 'Name',
      sortKey: 'name',
      cell: (property) => (
        <div>
          <div className="font-medium">{property.name}</div>
          <div className="text-xs text-muted-foreground">
            {[property.city, property.county].filter(Boolean).join(', ') || 'No location set'}
          </div>
        </div>
      ),
    },
    {
      header: 'Type',
      sortKey: 'propertyType',
      cell: (property) => <Badge variant="secondary">{PROPERTY_TYPE_LABELS[property.propertyType]}</Badge>,
    },
    {
      header: 'Buildings',
      cell: (property) => property.buildingCount,
    },
    {
      header: 'Units',
      cell: (property) => property.unitCount,
    },
    {
      header: 'Status',
      cell: (property) => (
        <Badge variant={PROPERTY_STATUS_VARIANTS[property.status]}>
          {PROPERTY_STATUS_LABELS[property.status]}
        </Badge>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Properties"
        description="Every site in your portfolio. Buildings and units live inside these."
        actions={
          can('properties.create') ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              Add property
            </Button>
          ) : null
        }
      />

      <DataTableToolbar
        search={table.search}
        onSearchChange={table.onSearchChange}
        searchPlaceholder="Search name, address or city"
        hasFilters={hasFilters}
        onClear={() => {
          table.onSearchChange('');
          table.setFilter('propertyType', undefined);
          table.setFilter('status', undefined);
        }}
      >
        <FilterSelect
          label="Type"
          value={table.filters.propertyType}
          onChange={(value) => table.setFilter('propertyType', value)}
          options={selectOptions(PROPERTY_TYPE_LABELS)}
          allLabel="All types"
        />
        <FilterSelect
          label="Status"
          value={table.filters.status}
          onChange={(value) => table.setFilter('status', value)}
          options={selectOptions(PROPERTY_STATUS_LABELS)}
          allLabel="Active & inactive"
        />
      </DataTableToolbar>

      {isLoading ? (
        <TableSkeleton rows={5} columns={5} />
      ) : isError ? (
        <ErrorState
          description={
            error instanceof ApiError ? error.message : 'Properties could not be loaded.'
          }
          requestId={error instanceof ApiError ? error.requestId : undefined}
          onRetry={() => void refetch()}
        />
      ) : !data || data.data.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={hasFilters ? 'No properties match these filters' : 'No properties yet'}
          description={
            hasFilters
              ? 'Try a different search term or clear the filters.'
              : 'Add your first property to start building your portfolio.'
          }
          action={
            can('properties.create') && !hasFilters ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden />
                Add property
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <DataTable
            rows={data.data}
            columns={columns}
            rowKey={(property) => property.id}
            onRowClick={(property) => router.push(`/properties/${property.id}`)}
            sortBy={table.sortBy}
            sortOrder={table.sortOrder}
            onSort={table.toggleSort}
          />
          <DataTablePagination meta={data.meta} onPageChange={table.setPage} noun="property" nounPlural="properties" />
        </>
      )}

      <PropertyFormDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

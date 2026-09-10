'use client';

import { Plus, Wrench } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { CardSkeleton, EmptyState, ErrorState, TableSkeleton } from '@/components/states';
import { type Column, DataTable } from '@/components/data-table/data-table';
import { DataTablePagination } from '@/components/data-table/pagination';
import { DataTableToolbar, FilterSelect } from '@/components/data-table/toolbar';
import { useTableParams } from '@/components/data-table/use-table-params';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSession } from '@/features/auth/use-session';
import { MaintenanceFormDialog } from '@/features/operations/components/maintenance-form-dialog';
import {
  MAINTENANCE_STATUS_LABELS,
  MAINTENANCE_STATUS_VARIANTS,
  PRIORITY_LABELS,
  PRIORITY_VARIANTS,
} from '@/features/operations/labels';
import { useMaintenanceList, useMaintenanceSummary } from '@/features/operations/queries';
import type { MaintenanceRequest, MaintenanceStatus } from '@/features/operations/types';
import { useProperties } from '@/features/portfolio/queries';
import { ApiError } from '@/lib/api-client';
import { formatDate } from '@/lib/utils';

/** The board columns, in workflow order. */
const BOARD: MaintenanceStatus[] = ['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED'];

export default function MaintenancePage() {
  const { can } = useSession();
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);

  const table = useTableParams({ sortBy: 'createdAt', sortOrder: 'desc' });
  const { data, isLoading, isError, error, refetch } = useMaintenanceList(table.query);
  const summary = useMaintenanceSummary();
  const properties = useProperties({ limit: 100, sortBy: 'name', sortOrder: 'asc' });

  const hasFilters = Boolean(
    table.search || table.filters.status || table.filters.priority || table.filters.propertyId,
  );

  const columns: Column<MaintenanceRequest>[] = [
    {
      header: 'Job',
      cell: (request) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{request.title}</div>
          <div className="truncate text-xs text-muted-foreground">
            {request.property.name}
            {request.unit ? ` · unit ${request.unit.unitNumber}` : ' · whole property'}
          </div>
        </div>
      ),
    },
    {
      header: 'Priority',
      sortKey: 'priority',
      cell: (request) => (
        <Badge variant={PRIORITY_VARIANTS[request.priority]}>
          {PRIORITY_LABELS[request.priority]}
        </Badge>
      ),
    },
    {
      header: 'Status',
      sortKey: 'status',
      cell: (request) => (
        <Badge variant={MAINTENANCE_STATUS_VARIANTS[request.status]}>
          {MAINTENANCE_STATUS_LABELS[request.status]}
        </Badge>
      ),
    },
    {
      header: 'Assigned to',
      cell: (request) =>
        request.assignedTo ? (
          request.assignedTo.fullName
        ) : (
          <span className="text-muted-foreground">Nobody yet</span>
        ),
    },
    {
      header: 'Raised',
      sortKey: 'createdAt',
      cell: (request) => formatDate(request.createdAt),
    },
  ];

  return (
    <>
      <PageHeader
        title="Maintenance"
        description="Work on the properties: what has been reported, who has it, and where it got to."
        actions={
          can('maintenance.create') ? (
            <Button onClick={() => setFormOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              Raise request
            </Button>
          ) : null
        }
      />

      {summary.isLoading ? (
        <CardSkeleton count={4} />
      ) : summary.data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {BOARD.map((status) => (
            <Card
              key={status}
              // Clicking a column filters the table below rather than opening a
              // second, different view of the same data.
              className="cursor-pointer transition-colors hover:bg-muted/30"
              onClick={() => table.setFilter('status', status)}
            >
              <CardHeader className="pb-2">
                <CardDescription>{MAINTENANCE_STATUS_LABELS[status]}</CardDescription>
                <CardTitle className="text-2xl tabular-nums">
                  {summary.data.counts[status] ?? 0}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {status === 'PENDING' && summary.data.urgentOpen > 0
                  ? `${summary.data.urgentOpen} urgent still open`
                  : 'Click to filter'}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      <DataTableToolbar
        search={table.search}
        onSearchChange={table.onSearchChange}
        searchPlaceholder="Search title or description"
        hasFilters={hasFilters}
        onClear={() => {
          table.onSearchChange('');
          table.setFilter('status', undefined);
          table.setFilter('priority', undefined);
          table.setFilter('propertyId', undefined);
        }}
      >
        <FilterSelect
          label="Status"
          value={table.filters.status}
          onChange={(value) => table.setFilter('status', value)}
          options={(
            Object.keys(MAINTENANCE_STATUS_LABELS) as (keyof typeof MAINTENANCE_STATUS_LABELS)[]
          ).map((value) => ({ value, label: MAINTENANCE_STATUS_LABELS[value] }))}
          allLabel="All statuses"
        />
        <FilterSelect
          label="Priority"
          value={table.filters.priority}
          onChange={(value) => table.setFilter('priority', value)}
          options={(Object.keys(PRIORITY_LABELS) as (keyof typeof PRIORITY_LABELS)[]).map(
            (value) => ({ value, label: PRIORITY_LABELS[value] }),
          )}
          allLabel="All priorities"
        />
        <FilterSelect
          label="Property"
          value={table.filters.propertyId}
          onChange={(value) => table.setFilter('propertyId', value)}
          options={(properties.data?.data ?? []).map((property) => ({
            value: property.id,
            label: property.name,
          }))}
          allLabel="All properties"
        />
      </DataTableToolbar>

      {isLoading ? (
        <TableSkeleton rows={6} columns={5} />
      ) : isError ? (
        <ErrorState
          description={
            error instanceof ApiError ? error.message : 'Maintenance requests could not be loaded.'
          }
          onRetry={() => void refetch()}
        />
      ) : !data || data.data.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title={hasFilters ? 'No requests match these filters' : 'Nothing reported'}
          description={
            hasFilters
              ? 'Try a different search or clear the filters.'
              : 'Raise a request when something needs fixing. Each one keeps its own timeline, from reported to done.'
          }
          action={
            can('maintenance.create') && !hasFilters ? (
              <Button onClick={() => setFormOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden />
                Raise request
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <DataTable
            rows={data.data}
            columns={columns}
            rowKey={(request) => request.id}
            onRowClick={(request) => router.push(`/maintenance/${request.id}`)}
            sortBy={table.sortBy}
            sortOrder={table.sortOrder}
            onSort={table.toggleSort}
          />
          <DataTablePagination meta={data.meta} onPageChange={table.setPage} noun="request" />
        </>
      )}

      <MaintenanceFormDialog open={formOpen} onOpenChange={setFormOpen} />
    </>
  );
}

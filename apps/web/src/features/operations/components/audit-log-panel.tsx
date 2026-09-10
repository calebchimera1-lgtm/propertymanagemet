'use client';

import { ScrollText } from 'lucide-react';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/states';
import { type Column, DataTable } from '@/components/data-table/data-table';
import { DataTablePagination } from '@/components/data-table/pagination';
import { DataTableToolbar, FilterSelect } from '@/components/data-table/toolbar';
import { useTableParams } from '@/components/data-table/use-table-params';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/utils';
import { humaniseAction } from '../labels';
import { useAuditActions, useAuditLogs } from '../queries';
import type { AuditEntry } from '../types';

/**
 * The audit trail, read-only.
 *
 * There is no edit or delete control here because there is no such endpoint:
 * rows appear because something happened, and nothing in the product can make
 * them disappear.
 */
export function AuditLogPanel() {
  const table = useTableParams({ limit: 20 });
  const { data, isLoading, isError, error, refetch } = useAuditLogs(table.query);
  const actions = useAuditActions();

  const hasFilters = Boolean(table.search || table.filters.action || table.filters.entityType);

  const columns: Column<AuditEntry>[] = [
    {
      header: 'What happened',
      cell: (entry) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{humaniseAction(entry.action)}</div>
          <div className="truncate text-xs text-muted-foreground">
            {entry.entityType}
            {entry.entityId ? ` · ${entry.entityId.slice(-8)}` : ''}
          </div>
        </div>
      ),
    },
    {
      header: 'Who',
      cell: (entry) => (
        <div className="min-w-0">
          {/* actorEmail is a snapshot, so the trail stays readable even after
              the account behind it is gone. */}
          <div className="truncate">{entry.user?.fullName ?? 'Deleted user'}</div>
          <div className="truncate text-xs text-muted-foreground">{entry.actorEmail}</div>
        </div>
      ),
    },
    {
      header: 'Details',
      desktopOnly: true,
      cell: (entry) =>
        entry.metadata && Object.keys(entry.metadata).length > 0 ? (
          <span className="line-clamp-2 max-w-[22rem] font-mono text-xs text-muted-foreground">
            {Object.entries(entry.metadata)
              .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
              .join(', ')}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { header: 'When', cell: (entry) => formatDateTime(entry.createdAt) },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit log</CardTitle>
        <CardDescription>
          Everything that changed, who changed it and when. Append-only: nothing here can be edited
          or removed, by anyone. Passwords, tokens and secrets are never recorded.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <DataTableToolbar
          search={table.search}
          onSearchChange={table.onSearchChange}
          searchPlaceholder="Search action or actor"
          hasFilters={hasFilters}
          onClear={() => {
            table.onSearchChange('');
            table.setFilter('action', undefined);
            table.setFilter('entityType', undefined);
          }}
        >
          <FilterSelect
            label="Action"
            value={table.filters.action}
            onChange={(value) => table.setFilter('action', value)}
            // Only actions actually present, so the filter never offers a
            // choice that returns nothing.
            options={(actions.data ?? []).map((action) => ({
              value: action,
              label: humaniseAction(action),
            }))}
            allLabel="All actions"
          />
        </DataTableToolbar>

        {isLoading ? (
          <TableSkeleton rows={5} columns={4} />
        ) : isError ? (
          <ErrorState
            description={
              error instanceof ApiError ? error.message : 'The audit log could not be loaded.'
            }
            onRetry={() => void refetch()}
          />
        ) : !data || data.data.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title={hasFilters ? 'Nothing matches these filters' : 'Nothing recorded yet'}
            description={
              hasFilters
                ? 'Try a different search or clear the filters.'
                : 'Entries appear as people sign in and change things.'
            }
          />
        ) : (
          <>
            <DataTable rows={data.data} columns={columns} rowKey={(entry) => entry.id} />
            <DataTablePagination meta={data.meta} onPageChange={table.setPage} noun="entry" />
          </>
        )}
      </CardContent>
    </Card>
  );
}

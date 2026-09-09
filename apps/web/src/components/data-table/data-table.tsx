'use client';

import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import type * as React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface Column<T> {
  /** Key used for sorting; omit to make the column unsortable. */
  sortKey?: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  /** Rendered instead of `cell` in the mobile card layout. */
  mobileCell?: (row: T) => React.ReactNode;
  className?: string;
  /** Hide from the mobile card layout entirely. */
  desktopOnly?: boolean;
}

interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  /** Rendered as the last cell of every row — actions, usually. */
  rowActions?: (row: T) => React.ReactNode;
}

/**
 * The product's one table.
 *
 * Sorting and paging are server-driven: this component reports what the user
 * clicked and renders what comes back. It never sorts or filters in the
 * browser, because the browser only ever holds one page of the data.
 *
 * Below `md` it renders stacked cards rather than a horizontally squeezed
 * table — the mobile layout is designed, not shrunk.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  sortBy,
  sortOrder,
  onSort,
  rowActions,
}: DataTableProps<T>) {
  return (
    <>
      <Card className="hidden md:block">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left">
                <tr>
                  {columns.map((column) => {
                    const isSorted = column.sortKey && sortBy === column.sortKey;
                    return (
                      <th
                        key={column.header}
                        scope="col"
                        aria-sort={
                          isSorted ? (sortOrder === 'asc' ? 'ascending' : 'descending') : undefined
                        }
                        className={cn('px-4 py-3 font-medium', column.className)}
                      >
                        {column.sortKey && onSort ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 hover:text-foreground"
                            onClick={() => onSort(column.sortKey as string)}
                          >
                            {column.header}
                            {isSorted ? (
                              sortOrder === 'asc' ? (
                                <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                              ) : (
                                <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                              )
                            ) : (
                              <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" aria-hidden />
                            )}
                          </button>
                        ) : (
                          column.header
                        )}
                      </th>
                    );
                  })}
                  {rowActions ? (
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={rowKey(row)}
                    className={cn(
                      'border-b last:border-0',
                      onRowClick && 'cursor-pointer hover:bg-muted/30',
                    )}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {columns.map((column) => (
                      <td key={column.header} className={cn('px-4 py-3', column.className)}>
                        {column.cell(row)}
                      </td>
                    ))}
                    {rowActions ? (
                      <td
                        className="px-4 py-3 text-right"
                        // Actions must not also trigger the row's navigation.
                        onClick={(event) => event.stopPropagation()}
                      >
                        {rowActions(row)}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3 md:hidden">
        {rows.map((row) => (
          <Card key={rowKey(row)}>
            <CardContent
              className={cn('space-y-2 p-4', onRowClick && 'cursor-pointer')}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns
                .filter((column) => !column.desktopOnly)
                .map((column) => (
                  <div key={column.header} className="flex items-start justify-between gap-3">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {column.header}
                    </span>
                    <span className="text-right text-sm">
                      {(column.mobileCell ?? column.cell)(row)}
                    </span>
                  </div>
                ))}
              {rowActions ? (
                <div
                  className="flex justify-end pt-1"
                  onClick={(event) => event.stopPropagation()}
                >
                  {rowActions(row)}
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

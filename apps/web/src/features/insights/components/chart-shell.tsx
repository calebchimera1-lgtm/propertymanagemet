'use client';

import { Table2 } from 'lucide-react';
import { useState } from 'react';
import type * as React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * The frame every chart on the dashboard sits in.
 *
 * It carries the table view, which is not a nicety: three of the series colours
 * sit under 3:1 against the light card, so the palette's relief rule requires
 * the numbers to be reachable another way. It also happens to be how anyone
 * reads an exact figure off a chart.
 */
export function ChartShell({
  title,
  description,
  loading,
  empty,
  emptyMessage = 'Nothing to chart yet.',
  table,
  children,
  className,
}: {
  title: string;
  description?: string;
  loading?: boolean;
  empty?: boolean;
  emptyMessage?: string;
  /** The same data as a table. Required — see the note above. */
  table: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const [showTable, setShowTable] = useState(false);

  return (
    <Card className={className}>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 pb-2">
        <div className="min-w-0">
          <CardTitle className="text-base">{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {!loading && !empty ? (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            aria-pressed={showTable}
            onClick={() => setShowTable((current) => !current)}
          >
            <Table2 className="h-4 w-4" aria-hidden />
            <span className="sr-only sm:not-sr-only">{showTable ? 'Chart' : 'Table'}</span>
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-56 w-full" />
        ) : empty ? (
          <p className="flex h-56 items-center justify-center text-center text-sm text-muted-foreground">
            {emptyMessage}
          </p>
        ) : showTable ? (
          <div className="max-h-56 overflow-auto">{table}</div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

/** The table half of a chart: compact, tabular figures, scrollable. */
export function ChartTable({
  head,
  children,
}: {
  head: string[];
  children: React.ReactNode;
}) {
  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 bg-card text-left">
        <tr className="border-b">
          {head.map((label, index) => (
            <th
              key={label}
              className={cn(
                'py-1.5 pr-3 font-medium text-muted-foreground',
                index > 0 && 'text-right',
              )}
            >
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y">{children}</tbody>
    </table>
  );
}

export function ChartTableRow({ cells }: { cells: (string | number)[] }) {
  return (
    <tr>
      {cells.map((cell, index) => (
        <td
          key={index}
          className={cn('py-1.5 pr-3', index > 0 && 'text-right tabular-nums')}
        >
          {cell}
        </td>
      ))}
    </tr>
  );
}

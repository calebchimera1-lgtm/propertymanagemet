'use client';

import { ArrowLeft, Download, FileBarChart, FileText } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { DataTablePagination } from '@/components/data-table/pagination';
import { FilterSelect } from '@/components/data-table/toolbar';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useSession } from '@/features/auth/use-session';
import { currentPeriod, periodLabel, recentPeriods } from '@/features/finance/labels';
import { EXPENSE_CATEGORY_LABELS, PAYMENT_METHOD_LABELS } from '@/features/finance/labels';
import { insightsApi } from '@/features/insights/api';
import { useReport, useReportCatalogue } from '@/features/insights/queries';
import type { ReportColumn, ReportRow } from '@/features/insights/types';
import { useProperties } from '@/features/portfolio/queries';
import { ApiError } from '@/lib/api-client';
import { cn, formatDate, formatMoney } from '@/lib/utils';

type Filters = Record<string, string | undefined>;

/**
 * One renderer for all nine reports.
 *
 * The API says what its columns are and how each should be formatted, so the
 * screen does not need nine table components that could each drift from the
 * export. Adding a tenth report is a strategy on the server and nothing here.
 */
function renderCell(row: ReportRow, column: ReportColumn, currency: string): string {
  const value = row[column.key];
  if (value === null || value === undefined || value === '') return '—';

  switch (column.format) {
    case 'money':
      return formatMoney(String(value), currency);
    case 'date':
      return formatDate(String(value));
    case 'percent':
      return `${value}%`;
    case 'number':
      return String(value);
    default:
      return String(value);
  }
}

export default function ReportRunnerPage() {
  const { report: reportKey } = useParams<{ report: string }>();
  const { can, me } = useSession();
  const currency = me?.organization.currency ?? 'KES';

  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const [downloading, setDownloading] = useState<'csv' | 'pdf' | null>(null);

  const catalogue = useReportCatalogue();
  const entry = catalogue.data?.find((item) => item.key === reportKey);

  const query = { ...filters, page, limit: 50 };
  const result = useReport(reportKey, query);
  const properties = useProperties({ limit: 100, sortBy: 'name', sortOrder: 'asc' });

  const honours = (filter: string) => entry?.filters.includes(filter) ?? false;
  const hasFilters = Object.values(filters).some(Boolean);

  function setFilter(key: string, value: string | undefined) {
    setFilters((current) => ({ ...current, [key]: value || undefined }));
    setPage(1);
  }

  /**
   * Downloads through the API client so the session cookie goes with it.
   *
   * An export runs the same guards as the screen, so a plain `<a href>` would
   * be an anonymous request and get a 401.
   */
  async function download(format: 'csv' | 'pdf') {
    setDownloading(format);
    try {
      const { blob, filename } = await insightsApi.reports.export(reportKey, {
        ...filters,
        format,
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename ?? `${reportKey}.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'That report could not be downloaded.',
      );
    } finally {
      setDownloading(null);
    }
  }

  if (result.isError) {
    return (
      <>
        <PageHeader title="Report" />
        <ErrorState
          title={
            result.error instanceof ApiError && result.error.status === 404
              ? 'No such report'
              : 'Report unavailable'
          }
          description={
            result.error instanceof ApiError
              ? result.error.message
              : 'The report could not be run.'
          }
          onRetry={() => void result.refetch()}
        />
      </>
    );
  }

  const columns = result.data?.columns ?? [];
  const rows = result.data?.rows ?? [];
  const totals = result.data?.totals ?? {};
  const hasTotals = Object.keys(totals).length > 0;

  return (
    <>
      <PageHeader
        title={result.data?.report.title ?? entry?.title ?? 'Report'}
        description={result.data?.report.description ?? entry?.description}
        actions={
          can('reports.export') ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                loading={downloading === 'csv'}
                disabled={downloading !== null}
                onClick={() => void download('csv')}
              >
                <Download className="h-4 w-4" aria-hidden />
                CSV
              </Button>
              <Button
                variant="outline"
                loading={downloading === 'pdf'}
                disabled={downloading !== null}
                onClick={() => void download('pdf')}
              >
                <FileText className="h-4 w-4" aria-hidden />
                PDF
              </Button>
            </div>
          ) : null
        }
      />

      {result.data?.scoped ? (
        <Alert variant="info">
          <AlertDescription>
            This report covers the properties assigned to you, not the whole organization. The
            export says so on the page too.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Only the filters this report actually honours — offering one it ignores
          would have the reader believe the numbers changed when they did not. */}
      <div className="flex flex-wrap items-end gap-3">
        {honours('period') ? (
          <FilterSelect
            label="Period"
            value={filters.period}
            onChange={(value) => setFilter('period', value)}
            options={recentPeriods(12).map((value) => ({ value, label: periodLabel(value) }))}
            allLabel="Every period"
          />
        ) : null}

        {honours('dateFrom') ? (
          <div className="space-y-1">
            <label htmlFor="dateFrom" className="text-xs text-muted-foreground">
              From
            </label>
            <Input
              id="dateFrom"
              type="date"
              className="h-10 w-[150px]"
              value={filters.dateFrom ?? ''}
              onChange={(event) => setFilter('dateFrom', event.target.value)}
            />
          </div>
        ) : null}

        {honours('dateTo') ? (
          <div className="space-y-1">
            <label htmlFor="dateTo" className="text-xs text-muted-foreground">
              To
            </label>
            <Input
              id="dateTo"
              type="date"
              className="h-10 w-[150px]"
              value={filters.dateTo ?? ''}
              onChange={(event) => setFilter('dateTo', event.target.value)}
            />
          </div>
        ) : null}

        {honours('propertyId') ? (
          <FilterSelect
            label="Property"
            value={filters.propertyId}
            onChange={(value) => setFilter('propertyId', value)}
            options={(properties.data?.data ?? []).map((property) => ({
              value: property.id,
              label: property.name,
            }))}
            allLabel="All properties"
          />
        ) : null}

        {honours('category') ? (
          <FilterSelect
            label="Category"
            value={filters.category}
            onChange={(value) => setFilter('category', value)}
            options={(
              Object.keys(EXPENSE_CATEGORY_LABELS) as (keyof typeof EXPENSE_CATEGORY_LABELS)[]
            ).map((value) => ({ value, label: EXPENSE_CATEGORY_LABELS[value] }))}
            allLabel="All categories"
          />
        ) : null}

        {honours('paymentMethod') ? (
          <FilterSelect
            label="Method"
            value={filters.paymentMethod}
            onChange={(value) => setFilter('paymentMethod', value)}
            options={(
              Object.keys(PAYMENT_METHOD_LABELS) as (keyof typeof PAYMENT_METHOD_LABELS)[]
            ).map((value) => ({ value, label: PAYMENT_METHOD_LABELS[value] }))}
            allLabel="All methods"
          />
        ) : null}

        {hasFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFilters({});
              setPage(1);
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      {result.isLoading ? (
        <TableSkeleton rows={8} columns={6} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={FileBarChart}
          title="No records match these filters"
          description={
            hasFilters
              ? 'Try widening the date range, or clear the filters to see everything.'
              : 'There is nothing to report on yet. This is an empty result, not a failed one.'
          }
        />
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/50 text-left">
                    <tr>
                      {columns.map((column) => (
                        <th
                          key={column.key}
                          className={cn(
                            'whitespace-nowrap px-4 py-3 font-medium',
                            column.numeric && 'text-right',
                          )}
                        >
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map((row, index) => (
                      <tr key={index} className="hover:bg-muted/30">
                        {columns.map((column) => (
                          <td
                            key={column.key}
                            className={cn(
                              'px-4 py-3',
                              column.numeric && 'text-right tabular-nums',
                            )}
                          >
                            {renderCell(row, column, currency)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  {hasTotals ? (
                    <tfoot className="border-t-2 bg-muted/30 font-medium">
                      <tr>
                        {columns.map((column, index) => (
                          <td
                            key={column.key}
                            className={cn('px-4 py-3', column.numeric && 'text-right tabular-nums')}
                          >
                            {index === 0
                              ? 'Total'
                              : totals[column.key] !== undefined
                                ? renderCell(
                                    totals as ReportRow,
                                    column,
                                    currency,
                                  )
                                : ''}
                          </td>
                        ))}
                      </tr>
                    </tfoot>
                  ) : null}
                </table>
              </div>
            </CardContent>
          </Card>

          {/* The totals are for every matching row, not just this page — said
              out loud, because a footer that only added up what is visible is
              the classic report bug. */}
          {hasTotals && (result.data?.meta.total ?? 0) > rows.length ? (
            <p className="text-xs text-muted-foreground">
              Totals cover all {result.data?.meta.total} matching records, not just this page.
            </p>
          ) : null}

          <DataTablePagination
            meta={{
              total: result.data?.meta.total ?? 0,
              page: result.data?.meta.page ?? 1,
              limit: result.data?.meta.limit ?? 50,
              totalPages: Math.max(
                1,
                Math.ceil((result.data?.meta.total ?? 0) / (result.data?.meta.limit ?? 50)),
              ),
            }}
            onPageChange={setPage}
            noun="record"
          />
        </>
      )}

      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/reports">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            All reports
          </Link>
        </Button>
      </div>
    </>
  );
}

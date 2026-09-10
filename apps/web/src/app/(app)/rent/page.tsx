'use client';

import { CircleDollarSign, RefreshCw, Wallet } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
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
import { RecordPaymentDialog } from '@/features/finance/components/record-payment-dialog';
import {
  RENT_STATUS_LABELS,
  RENT_STATUS_VARIANTS,
  currentPeriod,
  overdueLabel,
  periodLabel,
  recentPeriods,
} from '@/features/finance/labels';
import { useRentMutations, useRentRoll, useRentSummary } from '@/features/finance/queries';
import type { RentRecord } from '@/features/finance/types';
import { useProperties } from '@/features/portfolio/queries';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/utils';

export default function RentPage() {
  const { can, me } = useSession();
  const currency = me?.organization.currency ?? 'KES';

  const [period, setPeriod] = useState(currentPeriod());
  const [paying, setPaying] = useState<RentRecord | null>(null);

  const table = useTableParams({ sortBy: 'dueDate', sortOrder: 'asc' });
  const query = { ...table.query, period };
  const { data, isLoading, isError, error, refetch } = useRentRoll(query);
  const summary = useRentSummary({ period });
  const properties = useProperties({ limit: 100, sortBy: 'name', sortOrder: 'asc' });
  const { generate } = useRentMutations();

  const hasFilters = Boolean(table.search || table.filters.status || table.filters.propertyId);

  const columns: Column<RentRecord>[] = [
    {
      header: 'Tenant',
      cell: (record) => (
        <div>
          <div className="font-medium">{record.tenant.fullName}</div>
          <div className="text-xs text-muted-foreground">
            {record.unit.unitNumber} · {record.property.name}
          </div>
        </div>
      ),
    },
    {
      header: 'Charged',
      sortKey: 'expectedAmount',
      cell: (record) => (
        <span className="tabular-nums">{formatMoney(record.expectedAmount, currency)}</span>
      ),
    },
    {
      header: 'Paid',
      cell: (record) => (
        <span className="tabular-nums">{formatMoney(record.paidAmount, currency)}</span>
      ),
    },
    {
      header: 'Owing',
      sortKey: 'balance',
      cell: (record) => (
        <span className="font-medium tabular-nums">{formatMoney(record.balance, currency)}</span>
      ),
    },
    {
      header: 'Due',
      sortKey: 'dueDate',
      cell: (record) => (
        <div>
          <div>{formatDate(record.dueDate)}</div>
          {record.daysOverdue > 0 ? (
            <div className="text-xs text-destructive">{overdueLabel(record.daysOverdue)}</div>
          ) : null}
        </div>
      ),
    },
    {
      header: 'Status',
      cell: (record) => (
        <Badge variant={RENT_STATUS_VARIANTS[record.status]}>
          {RENT_STATUS_LABELS[record.status]}
        </Badge>
      ),
    },
  ];

  const totals = summary.data?.totals;

  return (
    <>
      <PageHeader
        title="Rent"
        description={`Charges for ${periodLabel(period)}. Every figure is read from the database — nothing here is estimated.`}
        actions={
          can('rent.generate') ? (
            <Button
              variant="outline"
              loading={generate.isPending}
              onClick={async () => {
                try {
                  const result = await generate.mutateAsync({ period });
                  toast.success(
                    result.created > 0
                      ? `${result.created} charge${result.created === 1 ? '' : 's'} generated.`
                      : `Already generated — ${result.skipped} charge${result.skipped === 1 ? '' : 's'} were already there.`,
                  );
                  if (result.expiredLeasesSkipped > 0) {
                    toast.info(
                      `${result.expiredLeasesSkipped} expired lease${result.expiredLeasesSkipped === 1 ? '' : 's'} not billed. Renew or end them first.`,
                    );
                  }
                } catch (mutationError) {
                  toast.error(
                    mutationError instanceof ApiError
                      ? mutationError.message
                      : 'Could not generate charges.',
                  );
                }
              }}
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              Generate charges
            </Button>
          ) : null
        }
      />

      {summary.isLoading ? (
        <CardSkeleton count={4} />
      ) : totals ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Charged</CardDescription>
              <CardTitle className="text-2xl tabular-nums">
                {formatMoney(totals.expected, currency)}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {summary.data?.recordCount} charge{summary.data?.recordCount === 1 ? '' : 's'}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Collected</CardDescription>
              <CardTitle className="text-2xl tabular-nums text-success">
                {formatMoney(totals.collected, currency)}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {totals.collectionRate}% of what was charged
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Outstanding</CardDescription>
              <CardTitle className="text-2xl tabular-nums">
                {formatMoney(totals.outstanding, currency)}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">Still to come in</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Overdue</CardDescription>
              <CardTitle className="text-2xl tabular-nums text-destructive">
                {formatMoney(totals.overdue, currency)}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">Past its due date</CardContent>
          </Card>
        </div>
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
          label="Period"
          value={period}
          onChange={(value) => {
            setPeriod(value ?? currentPeriod());
            table.setPage(1);
          }}
          options={recentPeriods(12).map((value) => ({ value, label: periodLabel(value) }))}
          allLabel={periodLabel(currentPeriod())}
        />
        <FilterSelect
          label="Status"
          value={table.filters.status}
          onChange={(value) => table.setFilter('status', value)}
          options={(Object.keys(RENT_STATUS_LABELS) as (keyof typeof RENT_STATUS_LABELS)[]).map(
            (value) => ({ value, label: RENT_STATUS_LABELS[value] }),
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
        <TableSkeleton rows={6} columns={6} />
      ) : isError ? (
        <ErrorState
          description={error instanceof ApiError ? error.message : 'The rent roll could not be loaded.'}
          onRetry={() => void refetch()}
        />
      ) : !data || data.data.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title={hasFilters ? 'No charges match these filters' : `No charges for ${periodLabel(period)}`}
          description={
            hasFilters
              ? 'Try a different search or clear the filters.'
              : 'Generate this month’s charges from the active leases. Running it twice is safe — it creates nothing the second time.'
          }
        />
      ) : (
        <>
          <DataTable
            rows={data.data}
            columns={columns}
            rowKey={(record) => record.id}
            sortBy={table.sortBy}
            sortOrder={table.sortOrder}
            onSort={table.toggleSort}
            rowActions={(record) =>
              can('payments.create') && Number(record.balance) > 0 ? (
                <Button size="sm" onClick={() => setPaying(record)}>
                  <CircleDollarSign className="h-4 w-4" aria-hidden />
                  Record payment
                </Button>
              ) : null
            }
          />
          <DataTablePagination meta={data.meta} onPageChange={table.setPage} noun="charge" />
        </>
      )}

      {paying ? (
        <RecordPaymentDialog
          open={Boolean(paying)}
          onOpenChange={(open) => !open && setPaying(null)}
          rentRecord={paying}
        />
      ) : null}
    </>
  );
}

'use client';

import { Ban, CircleDollarSign, Receipt as ReceiptIcon } from 'lucide-react';
import Link from 'next/link';
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
import { VoidPaymentDialog } from '@/features/finance/components/void-payment-dialog';
import { PAYMENT_METHOD_LABELS } from '@/features/finance/labels';
import { usePayments } from '@/features/finance/queries';
import type { Payment } from '@/features/finance/types';
import { useProperties } from '@/features/portfolio/queries';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/utils';

export default function PaymentsPage() {
  const { can, me } = useSession();
  const currency = me?.organization.currency ?? 'KES';

  const [voiding, setVoiding] = useState<Payment | null>(null);

  const table = useTableParams({ sortBy: 'paymentDate', sortOrder: 'desc' });
  const { data, isLoading, isError, error, refetch } = usePayments(table.query);
  const properties = useProperties({ limit: 100, sortBy: 'name', sortOrder: 'asc' });

  const hasFilters = Boolean(
    table.search || table.filters.paymentMethod || table.filters.status || table.filters.propertyId,
  );

  const columns: Column<Payment>[] = [
    {
      header: 'Tenant',
      cell: (payment) => (
        <div>
          <div className="font-medium">{payment.tenant.fullName}</div>
          <div className="text-xs text-muted-foreground">
            {payment.unit.unitNumber} · {payment.property.name}
          </div>
        </div>
      ),
    },
    {
      header: 'Amount',
      sortKey: 'amount',
      cell: (payment) => (
        <span
          className={
            payment.status === 'VOIDED'
              ? 'tabular-nums text-muted-foreground line-through'
              : 'font-medium tabular-nums'
          }
        >
          {formatMoney(payment.amount, currency)}
        </span>
      ),
    },
    {
      header: 'For',
      cell: (payment) => payment.periodLabel ?? '—',
    },
    {
      header: 'Method',
      cell: (payment) => (
        <div>
          <div>{PAYMENT_METHOD_LABELS[payment.paymentMethod]}</div>
          {payment.reference ? (
            <div className="font-mono text-xs text-muted-foreground">{payment.reference}</div>
          ) : null}
        </div>
      ),
    },
    {
      header: 'Paid on',
      sortKey: 'paymentDate',
      cell: (payment) => formatDate(payment.paymentDate),
    },
    {
      header: 'Receipt',
      cell: (payment) =>
        payment.receipt ? (
          can('receipts.view') ? (
            <Link
              href={`/receipts/${payment.receipt.id}`}
              className="font-mono text-xs text-primary hover:underline"
            >
              {payment.receipt.receiptNumber}
            </Link>
          ) : (
            <span className="font-mono text-xs">{payment.receipt.receiptNumber}</span>
          )
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      header: 'Status',
      cell: (payment) =>
        payment.status === 'VOIDED' ? (
          <div>
            <Badge variant="destructive">Voided</Badge>
            {payment.voidReason ? (
              <div className="mt-1 max-w-[14rem] truncate text-xs text-muted-foreground">
                {payment.voidReason}
              </div>
            ) : null}
          </div>
        ) : (
          <Badge variant="success">Completed</Badge>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Payments"
        description="Every payment recorded against a rent charge. Payments are never edited or deleted — a mistake is corrected by voiding it."
      />

      {isLoading ? (
        <CardSkeleton count={1} />
      ) : data ? (
        <Card className="sm:max-w-xs">
          <CardHeader className="pb-2">
            <CardDescription>Total in this view</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {formatMoney(data.totalAmount, currency)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {data.meta.total} payment{data.meta.total === 1 ? '' : 's'} match these filters. Voided
            payments are excluded from the total.
          </CardContent>
        </Card>
      ) : null}

      <DataTableToolbar
        search={table.search}
        onSearchChange={table.onSearchChange}
        searchPlaceholder="Search tenant, unit or reference"
        hasFilters={hasFilters}
        onClear={() => {
          table.onSearchChange('');
          table.setFilter('paymentMethod', undefined);
          table.setFilter('status', undefined);
          table.setFilter('propertyId', undefined);
        }}
      >
        <FilterSelect
          label="Method"
          value={table.filters.paymentMethod}
          onChange={(value) => table.setFilter('paymentMethod', value)}
          options={(Object.keys(PAYMENT_METHOD_LABELS) as (keyof typeof PAYMENT_METHOD_LABELS)[]).map(
            (value) => ({ value, label: PAYMENT_METHOD_LABELS[value] }),
          )}
          allLabel="All methods"
        />
        <FilterSelect
          label="Status"
          value={table.filters.status}
          onChange={(value) => table.setFilter('status', value)}
          options={[
            { value: 'COMPLETED', label: 'Completed' },
            { value: 'VOIDED', label: 'Voided' },
          ]}
          allLabel="All statuses"
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
        <TableSkeleton rows={6} columns={7} />
      ) : isError ? (
        <ErrorState
          description={error instanceof ApiError ? error.message : 'Payments could not be loaded.'}
          onRetry={() => void refetch()}
        />
      ) : !data || data.data.length === 0 ? (
        <EmptyState
          icon={CircleDollarSign}
          title={hasFilters ? 'No payments match these filters' : 'No payments yet'}
          description={
            hasFilters
              ? 'Try a different search or clear the filters.'
              : 'Payments are recorded against a rent charge. Open the rent roll and use "Record payment" on the row you are collecting for.'
          }
          action={
            hasFilters ? null : (
              <Button asChild>
                <Link href="/rent">
                  <ReceiptIcon className="h-4 w-4" aria-hidden />
                  Go to the rent roll
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <>
          <DataTable
            rows={data.data}
            columns={columns}
            rowKey={(payment) => payment.id}
            sortBy={table.sortBy}
            sortOrder={table.sortOrder}
            onSort={table.toggleSort}
            rowActions={(payment) =>
              can('payments.void') && payment.status === 'COMPLETED' ? (
                <Button variant="outline" size="sm" onClick={() => setVoiding(payment)}>
                  <Ban className="h-4 w-4" aria-hidden />
                  Void
                </Button>
              ) : null
            }
          />
          <DataTablePagination meta={data.meta} onPageChange={table.setPage} noun="payment" />
        </>
      )}

      {voiding ? (
        <VoidPaymentDialog
          open={Boolean(voiding)}
          onOpenChange={(open) => !open && setVoiding(null)}
          payment={voiding}
        />
      ) : null}
    </>
  );
}

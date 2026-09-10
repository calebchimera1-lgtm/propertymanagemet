'use client';

import { Receipt as ReceiptIcon } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/states';
import { type Column, DataTable } from '@/components/data-table/data-table';
import { DataTablePagination } from '@/components/data-table/pagination';
import { DataTableToolbar, FilterSelect } from '@/components/data-table/toolbar';
import { useTableParams } from '@/components/data-table/use-table-params';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useSession } from '@/features/auth/use-session';
import { PAYMENT_METHOD_LABELS } from '@/features/finance/labels';
import { useReceipts } from '@/features/finance/queries';
import type { Receipt } from '@/features/finance/types';
import { useProperties } from '@/features/portfolio/queries';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/utils';

export default function ReceiptsPage() {
  const { me } = useSession();
  const currency = me?.organization.currency ?? 'KES';

  const table = useTableParams({ sortBy: 'createdAt', sortOrder: 'desc' });
  const { data, isLoading, isError, error, refetch } = useReceipts(table.query);
  const properties = useProperties({ limit: 100, sortBy: 'name', sortOrder: 'asc' });

  const hasFilters = Boolean(
    table.search || table.filters.propertyId || table.filters.includeVoided,
  );

  const columns: Column<Receipt>[] = [
    {
      header: 'Receipt',
      cell: (receipt) => (
        <Link
          href={`/receipts/${receipt.id}`}
          className="font-mono text-sm font-medium text-primary hover:underline"
        >
          {receipt.receiptNumber}
        </Link>
      ),
    },
    {
      header: 'Tenant',
      cell: (receipt) => (
        <div>
          <div className="font-medium">{receipt.tenant.fullName}</div>
          <div className="text-xs text-muted-foreground">
            {receipt.unit.unitNumber} · {receipt.property.name}
          </div>
        </div>
      ),
    },
    {
      header: 'Amount',
      cell: (receipt) => (
        <span
          className={
            receipt.voidedAt
              ? 'tabular-nums text-muted-foreground line-through'
              : 'font-medium tabular-nums'
          }
        >
          {formatMoney(receipt.amount, currency)}
        </span>
      ),
    },
    { header: 'For', cell: (receipt) => receipt.periodLabel ?? '—' },
    { header: 'Method', cell: (receipt) => PAYMENT_METHOD_LABELS[receipt.paymentMethod] },
    { header: 'Issued', cell: (receipt) => formatDate(receipt.paymentDate) },
    {
      header: 'Status',
      cell: (receipt) =>
        receipt.voidedAt ? <Badge variant="destructive">Void</Badge> : <Badge variant="success">Valid</Badge>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Receipts"
        description="One receipt per payment, numbered without gaps. A voided receipt keeps its number so the sequence can be audited."
      />

      <DataTableToolbar
        search={table.search}
        onSearchChange={table.onSearchChange}
        searchPlaceholder="Search receipt number or tenant"
        hasFilters={hasFilters}
        onClear={() => {
          table.onSearchChange('');
          table.setFilter('propertyId', undefined);
          table.setFilter('includeVoided', undefined);
        }}
      >
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
        <FilterSelect
          label="Voided"
          value={table.filters.includeVoided}
          onChange={(value) => table.setFilter('includeVoided', value)}
          options={[{ value: 'true', label: 'Include voided' }]}
          allLabel="Valid only"
        />
      </DataTableToolbar>

      {isLoading ? (
        <TableSkeleton rows={6} columns={7} />
      ) : isError ? (
        <ErrorState
          description={error instanceof ApiError ? error.message : 'Receipts could not be loaded.'}
          onRetry={() => void refetch()}
        />
      ) : !data || data.data.length === 0 ? (
        <EmptyState
          icon={ReceiptIcon}
          title={hasFilters ? 'No receipts match these filters' : 'No receipts yet'}
          description={
            hasFilters
              ? 'Try a different search or clear the filters.'
              : 'A receipt is issued automatically the moment a payment is recorded.'
          }
          action={
            hasFilters ? null : (
              <Button asChild>
                <Link href="/rent">Go to the rent roll</Link>
              </Button>
            )
          }
        />
      ) : (
        <>
          <DataTable
            rows={data.data}
            columns={columns}
            rowKey={(receipt) => receipt.id}
            sortBy={table.sortBy}
            sortOrder={table.sortOrder}
            onSort={table.toggleSort}
            rowActions={(receipt) => (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/receipts/${receipt.id}`}>Open</Link>
              </Button>
            )}
          />
          <DataTablePagination meta={data.meta} onPageChange={table.setPage} noun="receipt" />
        </>
      )}
    </>
  );
}

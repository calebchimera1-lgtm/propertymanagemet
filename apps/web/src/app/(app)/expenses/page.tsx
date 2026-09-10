'use client';

import { Pencil, Plus, Receipt as ReceiptIcon, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { CardSkeleton, EmptyState, ErrorState, TableSkeleton } from '@/components/states';
import { type Column, DataTable } from '@/components/data-table/data-table';
import { DataTablePagination } from '@/components/data-table/pagination';
import { DataTableToolbar, FilterSelect } from '@/components/data-table/toolbar';
import { useTableParams } from '@/components/data-table/use-table-params';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useSession } from '@/features/auth/use-session';
import { ExpenseFormDialog } from '@/features/finance/components/expense-form-dialog';
import { EXPENSE_CATEGORY_LABELS, PAYMENT_METHOD_LABELS } from '@/features/finance/labels';
import { useExpenseMutations, useExpenseSummary, useExpenses } from '@/features/finance/queries';
import type { Expense } from '@/features/finance/types';
import { useProperties } from '@/features/portfolio/queries';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/utils';

export default function ExpensesPage() {
  const { can, me } = useSession();
  const currency = me?.organization.currency ?? 'KES';

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | undefined>(undefined);
  const [deleting, setDeleting] = useState<Expense | null>(null);

  const table = useTableParams({ sortBy: 'expenseDate', sortOrder: 'desc' });
  const { data, isLoading, isError, error, refetch } = useExpenses(table.query);
  const properties = useProperties({ limit: 100, sortBy: 'name', sortOrder: 'asc' });
  const { remove } = useExpenseMutations();

  const summaryQuery = {
    ...(table.filters.propertyId ? { propertyId: table.filters.propertyId } : {}),
    ...(table.filters.category ? { category: table.filters.category } : {}),
  };
  const summary = useExpenseSummary(summaryQuery);

  const hasFilters = Boolean(table.search || table.filters.category || table.filters.propertyId);

  const columns: Column<Expense>[] = [
    {
      header: 'Description',
      cell: (expense) => (
        <div>
          <div className="font-medium">{expense.description}</div>
          <div className="text-xs text-muted-foreground">
            {expense.property.name}
            {expense.building ? ` · ${expense.building.name}` : ''}
            {expense.unit ? ` · unit ${expense.unit.unitNumber}` : ''}
          </div>
        </div>
      ),
    },
    {
      header: 'Category',
      sortKey: 'category',
      cell: (expense) => EXPENSE_CATEGORY_LABELS[expense.category],
    },
    {
      header: 'Amount',
      sortKey: 'amount',
      cell: (expense) => (
        <span className="font-medium tabular-nums">{formatMoney(expense.amount, currency)}</span>
      ),
    },
    { header: 'Date', sortKey: 'expenseDate', cell: (expense) => formatDate(expense.expenseDate) },
    {
      header: 'Vendor',
      cell: (expense) => (
        <div>
          <div>{expense.vendor ?? '—'}</div>
          {expense.paymentMethod ? (
            <div className="text-xs text-muted-foreground">
              {PAYMENT_METHOD_LABELS[expense.paymentMethod]}
            </div>
          ) : null}
        </div>
      ),
    },
  ];

  const topCategories = (summary.data?.byCategory ?? []).slice(0, 3);

  return (
    <>
      <PageHeader
        title="Expenses"
        description="Money spent running the properties. These are the costs subtracted from rent collected in the profit and loss report."
        actions={
          can('expenses.create') ? (
            <Button
              onClick={() => {
                setEditing(undefined);
                setFormOpen(true);
              }}
            >
              <Plus className="h-4 w-4" aria-hidden />
              Record expense
            </Button>
          ) : null
        }
      />

      {summary.isLoading ? (
        <CardSkeleton count={2} />
      ) : summary.data ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total spent</CardDescription>
              <CardTitle className="text-2xl tabular-nums">
                {formatMoney(summary.data.total, currency)}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Across {summary.data.count} expense{summary.data.count === 1 ? '' : 's'}
              {table.filters.propertyId || table.filters.category ? ' matching the filters below' : ''}.
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Biggest categories</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {topCategories.length === 0 ? (
                <span className="text-muted-foreground">Nothing recorded yet.</span>
              ) : (
                topCategories.map((row) => (
                  <div key={row.category} className="flex justify-between gap-4">
                    <span>{EXPENSE_CATEGORY_LABELS[row.category]}</span>
                    <span className="tabular-nums">{formatMoney(row.total, currency)}</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      <DataTableToolbar
        search={table.search}
        onSearchChange={table.onSearchChange}
        searchPlaceholder="Search description, vendor or reference"
        hasFilters={hasFilters}
        onClear={() => {
          table.onSearchChange('');
          table.setFilter('category', undefined);
          table.setFilter('propertyId', undefined);
        }}
      >
        <FilterSelect
          label="Category"
          value={table.filters.category}
          onChange={(value) => table.setFilter('category', value)}
          options={(
            Object.keys(EXPENSE_CATEGORY_LABELS) as (keyof typeof EXPENSE_CATEGORY_LABELS)[]
          ).map((value) => ({ value, label: EXPENSE_CATEGORY_LABELS[value] }))}
          allLabel="All categories"
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
          description={error instanceof ApiError ? error.message : 'Expenses could not be loaded.'}
          onRetry={() => void refetch()}
        />
      ) : !data || data.data.length === 0 ? (
        <EmptyState
          icon={ReceiptIcon}
          title={hasFilters ? 'No expenses match these filters' : 'No expenses recorded'}
          description={
            hasFilters
              ? 'Try a different search or clear the filters.'
              : 'Record what you spend on repairs, security, water and the rest so the profit figures mean something.'
          }
          action={
            can('expenses.create') && !hasFilters ? (
              <Button
                onClick={() => {
                  setEditing(undefined);
                  setFormOpen(true);
                }}
              >
                <Plus className="h-4 w-4" aria-hidden />
                Record expense
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <DataTable
            rows={data.data}
            columns={columns}
            rowKey={(expense) => expense.id}
            sortBy={table.sortBy}
            sortOrder={table.sortOrder}
            onSort={table.toggleSort}
            rowActions={(expense) => (
              <div className="flex gap-2">
                {can('expenses.update') ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditing(expense);
                      setFormOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                    <span className="sr-only sm:not-sr-only">Edit</span>
                  </Button>
                ) : null}
                {can('expenses.delete') ? (
                  <Button variant="ghost" size="sm" onClick={() => setDeleting(expense)}>
                    <Trash2 className="h-4 w-4 text-destructive" aria-hidden />
                    <span className="sr-only">Delete expense</span>
                  </Button>
                ) : null}
              </div>
            )}
          />
          <DataTablePagination meta={data.meta} onPageChange={table.setPage} noun="expense" />
        </>
      )}

      <ExpenseFormDialog open={formOpen} onOpenChange={setFormOpen} expense={editing} />

      {deleting ? (
        <ConfirmDialog
          open={Boolean(deleting)}
          onOpenChange={(open) => !open && setDeleting(null)}
          title="Delete this expense?"
          description={`"${deleting.description}" for ${formatMoney(deleting.amount, currency)} will be removed from the accounts. This cannot be undone.`}
          confirmLabel="Delete expense"
          destructive
          loading={remove.isPending}
          onConfirm={async () => {
            try {
              await remove.mutateAsync(deleting.id);
              toast.success('Expense deleted.');
              setDeleting(null);
            } catch (mutationError) {
              toast.error(
                mutationError instanceof ApiError
                  ? mutationError.message
                  : 'Could not delete the expense.',
              );
            }
          }}
        />
      ) : null}
    </>
  );
}

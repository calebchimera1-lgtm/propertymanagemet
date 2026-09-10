'use client';

import { ArrowLeft, Printer } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type * as React from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { CardSkeleton, ErrorState } from '@/components/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PAYMENT_METHOD_LABELS } from '@/features/finance/labels';
import { useReceipt } from '@/features/finance/queries';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatDateTime, formatMoney } from '@/lib/utils';

function Line({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

/**
 * The printable receipt.
 *
 * Everything outside `.print-page` is marked `.no-print`, so Ctrl+P produces
 * the document a tenant is handed — letterhead, receipt number, amount, method
 * and reference — and none of the application around it.
 */
export default function ReceiptDetailPage() {
  const { id } = useParams<{ id: string }>();
  const receipt = useReceipt(id);

  if (receipt.isLoading) return <CardSkeleton count={2} />;

  if (receipt.isError || !receipt.data) {
    return (
      <ErrorState
        title="Receipt unavailable"
        description={
          receipt.error instanceof ApiError && receipt.error.status === 404
            ? 'This receipt does not exist, or is not one you have access to.'
            : 'The receipt could not be loaded.'
        }
        onRetry={() => void receipt.refetch()}
      />
    );
  }

  const record = receipt.data;
  const currency = record.organization?.currency ?? 'KES';
  const organization = record.organization;
  const isVoid = Boolean(record.voidedAt);

  return (
    <>
      <div className="no-print">
        <PageHeader
          title={`Receipt ${record.receiptNumber}`}
          description={
            <Link href="/receipts" className="inline-flex items-center gap-1 text-primary hover:underline">
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              Back to receipts
            </Link>
          }
          actions={
            <Button onClick={() => window.print()}>
              <Printer className="h-4 w-4" aria-hidden />
              Print
            </Button>
          }
        />
      </div>

      {isVoid ? (
        <Alert variant="destructive" className="no-print">
          <AlertDescription>
            This receipt was voided on {formatDateTime(record.voidedAt)}. It is kept for the audit
            trail and its number is never reused. Do not issue it to a tenant.
          </AlertDescription>
        </Alert>
      ) : null}

      <article className="print-page print-keep-together mx-auto w-full max-w-2xl rounded-lg border bg-card p-8 shadow-sm">
        <header className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold">{organization?.name ?? '—'}</h2>
            <div className="mt-1 space-y-0.5 text-sm text-muted-foreground">
              {organization?.addressLine ? <div>{organization.addressLine}</div> : null}
              {organization?.city ? <div>{organization.city}</div> : null}
              {organization?.phone ? <div>{organization.phone}</div> : null}
              {organization?.email ? <div>{organization.email}</div> : null}
            </div>
          </div>
          <div className="sm:text-right">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Rent receipt
            </div>
            <div className="font-mono text-lg font-semibold">{record.receiptNumber}</div>
            <div className="text-sm text-muted-foreground">{formatDate(record.paymentDate)}</div>
            {isVoid ? (
              <div className="mt-2 inline-block rounded border border-destructive px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-destructive">
                Void
              </div>
            ) : null}
          </div>
        </header>

        <section className="border-b py-6 text-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Received from
          </div>
          <div className="mt-1 text-base font-medium">{record.tenant.fullName}</div>
          <div className="text-muted-foreground">
            {record.tenant.phone}
            {record.tenant.email ? ` · ${record.tenant.email}` : ''}
          </div>
        </section>

        <section className="border-b py-6 text-sm">
          <Line label="Property" value={record.property.name} />
          <Line label="Unit" value={record.unit.unitNumber} />
          <Line label="Rent for" value={record.periodLabel ?? '—'} />
          <Line label="Payment method" value={PAYMENT_METHOD_LABELS[record.paymentMethod]} />
          <Line
            label="Reference"
            value={record.reference ? <span className="font-mono">{record.reference}</span> : '—'}
          />
        </section>

        <section className="flex items-center justify-between py-6">
          <span className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Amount received
          </span>
          <span
            className={
              isVoid
                ? 'text-2xl font-semibold tabular-nums text-muted-foreground line-through'
                : 'text-2xl font-semibold tabular-nums'
            }
          >
            {formatMoney(record.amount, currency)}
          </span>
        </section>

        <footer className="border-t pt-4 text-xs text-muted-foreground">
          <p>
            Issued {formatDateTime(record.createdAt)} by {organization?.name ?? '—'}
            {organization?.code ? ` (${organization.code})` : ''}. This receipt acknowledges the
            amount above only; it is not a statement of the tenant&rsquo;s full account balance.
          </p>
        </footer>
      </article>
    </>
  );
}

'use client';

import { CalendarPlus, LogOut } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { CardSkeleton, ErrorState } from '@/components/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSession } from '@/features/auth/use-session';
import {
  RenewLeaseDialog,
  TerminateLeaseDialog,
} from '@/features/occupancy/components/lease-actions';
import {
  LEASE_STATUS_LABELS,
  LEASE_STATUS_VARIANTS,
  expiryLabel,
} from '@/features/occupancy/labels';
import { useLease } from '@/features/occupancy/queries';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatDateTime, formatMoney } from '@/lib/utils';

export default function LeaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can, me } = useSession();

  const lease = useLease(id);
  const [renewOpen, setRenewOpen] = useState(false);
  const [terminateOpen, setTerminateOpen] = useState(false);

  if (lease.isLoading) return <CardSkeleton count={3} />;

  if (lease.isError || !lease.data) {
    return (
      <ErrorState
        title="Lease unavailable"
        description={
          lease.error instanceof ApiError && lease.error.status === 404
            ? 'This lease does not exist, or is not one you have access to.'
            : 'The lease could not be loaded.'
        }
        onRetry={() => void lease.refetch()}
      />
    );
  }

  const record = lease.data;
  const currency = me?.organization.currency ?? 'KES';
  const isClosed = record.status === 'TERMINATED';

  return (
    <>
      <PageHeader
        title={`Lease · Unit ${record.unit.unitNumber}`}
        description={
          <>
            <Link href={`/tenants/${record.tenantId}`} className="text-primary hover:underline">
              {record.tenant.fullName}
            </Link>
            {' · '}
            <Link href={`/properties/${record.propertyId}`} className="text-primary hover:underline">
              {record.property.name}
            </Link>
            {record.building ? ` · ${record.building.name}` : ''}
          </>
        }
        actions={
          isClosed ? null : (
            <div className="flex flex-wrap gap-2">
              {can('leases.update') ? (
                <Button variant="outline" onClick={() => setRenewOpen(true)}>
                  <CalendarPlus className="h-4 w-4" aria-hidden />
                  Renew
                </Button>
              ) : null}
              {can('leases.terminate') ? (
                <Button variant="outline" onClick={() => setTerminateOpen(true)}>
                  <LogOut className="h-4 w-4" aria-hidden />
                  End lease
                </Button>
              ) : null}
            </div>
          )
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={LEASE_STATUS_VARIANTS[record.status]}>
          {LEASE_STATUS_LABELS[record.status]}
        </Badge>
        <span className="text-sm text-muted-foreground">
          {formatDate(record.startDate)} —{' '}
          {record.endDate ? formatDate(record.endDate) : 'open-ended'}
          {record.endDate ? ` · ${expiryLabel(record.daysUntilExpiry)}` : ''}
        </span>
      </div>

      {record.status === 'EXPIRED' ? (
        <Alert variant="warning">
          <AlertDescription>
            This lease passed its end date. The unit was <strong>not</strong> released — a tenant
            staying on is normal. Renew the lease, or end it to free the unit.
          </AlertDescription>
        </Alert>
      ) : null}

      {isClosed ? (
        <Alert variant="info">
          <AlertDescription>
            Ended {formatDateTime(record.terminatedAt)}
            {record.terminationReason ? ` — ${record.terminationReason}` : ''}. This lease is kept
            as the record of who lived here and on what terms.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Monthly rent</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {formatMoney(record.monthlyRent, currency)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Due on day {record.dueDay} of each month
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Deposit received</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {formatMoney(record.depositPaid, currency)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            of {formatMoney(record.securityDeposit, currency)} required
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Deposit outstanding</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {formatMoney(record.depositOutstanding, currency)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {/* Version 1 records the deposit; it does not run a refundable
                ledger with deductions and move-out refunds. */}
            Recorded, not held in a refund ledger
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Unit</CardDescription>
            <CardTitle className="text-2xl">{record.unit.unitNumber}</CardTitle>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm">
              <Link href={`/units/${record.unitId}`}>Open unit</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rent charges and payments</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="info">
            <AlertDescription>
              Rent records, payments and receipts for this lease arrive in Phase 4.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {record.notes ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{record.notes}</CardContent>
        </Card>
      ) : null}

      <RenewLeaseDialog open={renewOpen} onOpenChange={setRenewOpen} lease={record} />
      <TerminateLeaseDialog open={terminateOpen} onOpenChange={setTerminateOpen} lease={record} />
    </>
  );
}

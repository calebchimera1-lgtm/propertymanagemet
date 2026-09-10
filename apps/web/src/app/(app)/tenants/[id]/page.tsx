'use client';

import { FileText, Pencil, Plus, Trash2, UserX } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSession } from '@/features/auth/use-session';
import { LeaseFormDialog } from '@/features/occupancy/components/lease-form-dialog';
import { TenantFormDialog } from '@/features/occupancy/components/tenant-form-dialog';
import {
  ID_TYPE_LABELS,
  LEASE_STATUS_LABELS,
  LEASE_STATUS_VARIANTS,
} from '@/features/occupancy/labels';
import { useTenantMutations, useTenantProfile } from '@/features/occupancy/queries';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/utils';

export default function TenantProfilePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can, me } = useSession();

  const profile = useTenantProfile(id);
  const { update, remove } = useTenantMutations();

  const [editOpen, setEditOpen] = useState(false);
  const [leaseOpen, setLeaseOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (profile.isLoading) return <CardSkeleton count={3} />;

  if (profile.isError || !profile.data) {
    return (
      <ErrorState
        title="Tenant unavailable"
        description={
          profile.error instanceof ApiError && profile.error.status === 404
            ? 'This tenant does not exist, or is not one you have access to.'
            : 'The tenant could not be loaded.'
        }
        onRetry={() => void profile.refetch()}
      />
    );
  }

  const { tenant, currentLease, leaseHistory, finances } = profile.data;
  const currency = me?.organization.currency ?? 'KES';

  return (
    <>
      <PageHeader
        title={tenant.fullName}
        description={[tenant.phone, tenant.email, tenant.occupation].filter(Boolean).join(' · ')}
        actions={
          <div className="flex flex-wrap gap-2">
            {can('leases.create') && !currentLease ? (
              <Button onClick={() => setLeaseOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden />
                Create lease
              </Button>
            ) : null}
            {can('tenants.update') ? (
              <Button variant="outline" onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" aria-hidden />
                Edit
              </Button>
            ) : null}
            {can('tenants.update') && tenant.isActive ? (
              <Button variant="outline" onClick={() => setDeactivateOpen(true)}>
                <UserX className="h-4 w-4" aria-hidden />
                Deactivate
              </Button>
            ) : null}
            {can('tenants.delete') ? (
              <Button variant="ghost" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="h-4 w-4 text-destructive" aria-hidden />
                <span className="text-destructive">Delete</span>
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={tenant.isActive ? 'success' : 'secondary'}>
          {tenant.isActive ? 'Active' : 'Inactive'}
        </Badge>
        {currentLease ? (
          <Badge variant={LEASE_STATUS_VARIANTS[currentLease.status]}>
            {LEASE_STATUS_LABELS[currentLease.status]} · unit {currentLease.unit.unitNumber}
          </Badge>
        ) : (
          <Badge variant="outline">Not currently housed</Badge>
        )}
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="lease">Current lease</TabsTrigger>
          <TabsTrigger value="history">Lease history</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Details</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-4 sm:grid-cols-2">
                  <Detail label="Phone" value={tenant.phone} />
                  <Detail label="Email" value={tenant.email} />
                  <Detail
                    label="ID"
                    value={
                      tenant.nationalId
                        ? `${tenant.idType ? ID_TYPE_LABELS[tenant.idType] : 'ID'} · ${tenant.nationalId}`
                        : null
                    }
                  />
                  <Detail label="Occupation" value={tenant.occupation} />
                  <Detail label="Address" value={tenant.address} />
                  <Detail
                    label="Emergency contact"
                    value={
                      tenant.emergencyContactName
                        ? `${tenant.emergencyContactName} · ${tenant.emergencyContactPhone ?? '—'}`
                        : null
                    }
                  />
                  <Detail label="Added" value={formatDate(tenant.createdAt)} />
                </dl>
                {tenant.notes ? (
                  <p className="mt-4 border-t pt-4 text-sm text-muted-foreground">{tenant.notes}</p>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Finances</CardTitle>
                <CardDescription>Rent charged, paid and outstanding.</CardDescription>
              </CardHeader>
              <CardContent>
                {/* Deliberately not a row of zeroes: an unbuilt section must not
                    look like "nothing owed". */}
                <Alert variant="info">
                  <AlertDescription>{finances.reason}</AlertDescription>
                </Alert>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="lease">
          {currentLease ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Unit {currentLease.unit.unitNumber} · {currentLease.property.name}
                </CardTitle>
                <CardDescription>
                  {formatDate(currentLease.startDate)} —{' '}
                  {currentLease.endDate ? formatDate(currentLease.endDate) : 'open-ended'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-4 sm:grid-cols-3">
                  <Detail
                    label="Monthly rent"
                    value={formatMoney(currentLease.monthlyRent, currency)}
                  />
                  <Detail
                    label="Deposit"
                    value={`${formatMoney(currentLease.depositPaid, currency)} of ${formatMoney(currentLease.securityDeposit, currency)}`}
                  />
                  <Detail label="Rent due" value={`Day ${currentLease.dueDay} of each month`} />
                </dl>
                <Button asChild variant="outline" size="sm" className="mt-4">
                  <Link href={`/leases/${currentLease.id}`}>Open lease</Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <EmptyState
              icon={FileText}
              title="No current lease"
              description="This tenant is not housed at the moment. Create a lease to move them into a vacant unit."
              action={
                can('leases.create') ? (
                  <Button onClick={() => setLeaseOpen(true)}>
                    <Plus className="h-4 w-4" aria-hidden />
                    Create lease
                  </Button>
                ) : null
              }
            />
          )}
        </TabsContent>

        <TabsContent value="history">
          {leaseHistory.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No lease history"
              description="Leases for this tenant will be listed here, including ended ones."
            />
          ) : (
            <div className="space-y-3">
              {leaseHistory.map((lease) => (
                <Card key={lease.id}>
                  <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">
                          Unit {lease.unit.unitNumber} · {lease.property.name}
                        </span>
                        <Badge variant={LEASE_STATUS_VARIANTS[lease.status]}>
                          {LEASE_STATUS_LABELS[lease.status]}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {formatDate(lease.startDate)} —{' '}
                        {lease.endDate ? formatDate(lease.endDate) : 'open-ended'} ·{' '}
                        {formatMoney(lease.monthlyRent, currency)} / month
                      </p>
                      {lease.terminationReason ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Ended: {lease.terminationReason}
                        </p>
                      ) : null}
                    </div>
                    <Button asChild variant="outline" size="sm" className="shrink-0">
                      <Link href={`/leases/${lease.id}`}>View</Link>
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <TenantFormDialog open={editOpen} onOpenChange={setEditOpen} tenant={tenant} />
      <LeaseFormDialog open={leaseOpen} onOpenChange={setLeaseOpen} lockedTenantId={tenant.id} />

      <ConfirmDialog
        open={deactivateOpen}
        onOpenChange={setDeactivateOpen}
        title={`Deactivate ${tenant.fullName}?`}
        description="They stay on file with all their history, but are hidden from the default tenant list and cannot be given a new lease."
        confirmLabel="Deactivate"
        loading={update.isPending}
        onConfirm={async () => {
          try {
            await update.mutateAsync({ id: tenant.id, body: { isActive: false } });
            toast.success('Tenant deactivated.');
            setDeactivateOpen(false);
          } catch (error) {
            toast.error(error instanceof ApiError ? error.message : 'Could not deactivate.');
          }
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        destructive
        title={`Delete ${tenant.fullName}?`}
        description={
          leaseHistory.length > 0
            ? `This tenant has ${leaseHistory.length} lease record(s), so they cannot be deleted. Deactivate them instead — their history stays intact.`
            : 'This permanently removes the tenant. It cannot be undone.'
        }
        confirmLabel="Delete permanently"
        loading={remove.isPending}
        onConfirm={async () => {
          try {
            await remove.mutateAsync(tenant.id);
            toast.success('Tenant deleted.');
            setDeleteOpen(false);
            router.push('/tenants');
          } catch (error) {
            toast.error(error instanceof ApiError ? error.message : 'Could not delete the tenant.');
          }
        }}
      />
    </>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value || '—'}</dd>
    </div>
  );
}

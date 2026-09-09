'use client';

import { Pencil, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { CardSkeleton, ErrorState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSession } from '@/features/auth/use-session';
import { UnitFormDialog } from '@/features/portfolio/components/unit-form-dialog';
import {
  UNIT_STATUS_LABELS,
  UNIT_STATUS_VARIANTS,
  UNIT_TYPE_LABELS,
} from '@/features/portfolio/labels';
import { useUnit, useUnitMutations } from '@/features/portfolio/queries';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/utils';

/**
 * OCCUPIED is absent from this list on purpose: from Phase 3 it is derived from
 * an active lease, and letting someone set it by hand would put the unit table
 * and the lease table into permanent disagreement.
 */
const SETTABLE_STATUSES = ['VACANT', 'RESERVED', 'MAINTENANCE', 'UNAVAILABLE'] as const;

export default function UnitDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can, me } = useSession();

  const unit = useUnit(id);
  const { setStatus, remove } = useUnitMutations();

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (unit.isLoading) return <CardSkeleton count={3} />;

  if (unit.isError || !unit.data) {
    return (
      <ErrorState
        title="Unit unavailable"
        description={
          unit.error instanceof ApiError && unit.error.status === 404
            ? 'This unit does not exist, or it is not one you have access to.'
            : 'The unit could not be loaded.'
        }
        onRetry={() => void unit.refetch()}
      />
    );
  }

  const record = unit.data;
  const currency = me?.organization.currency ?? 'KES';
  const isOccupied = record.status === 'OCCUPIED';

  return (
    <>
      <PageHeader
        title={`Unit ${record.unitNumber}`}
        description={
          <>
            <Link
              href={`/properties/${record.propertyId}`}
              className="text-primary hover:underline"
            >
              {record.property.name}
            </Link>
            {record.building ? (
              <>
                {' · '}
                <Link
                  href={`/buildings/${record.building.id}`}
                  className="text-primary hover:underline"
                >
                  {record.building.name}
                </Link>
              </>
            ) : (
              ' · attached directly to the property'
            )}
          </>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {can('units.update') ? (
              <Button variant="outline" onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" aria-hidden />
                Edit
              </Button>
            ) : null}
            {can('units.delete') ? (
              <Button variant="ghost" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="h-4 w-4 text-destructive" aria-hidden />
                <span className="text-destructive">Delete</span>
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Monthly rent</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {formatMoney(record.monthlyRent, currency)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Security deposit</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {formatMoney(record.securityDeposit, currency)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Type</CardDescription>
            <CardTitle className="text-xl">{UNIT_TYPE_LABELS[record.unitType]}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {record.bedrooms ?? '—'} bed · {record.bathrooms ?? '—'} bath · floor{' '}
            {record.floor ?? '—'}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Status</CardDescription>
            <CardTitle>
              <Badge variant={UNIT_STATUS_VARIANTS[record.status]}>
                {UNIT_STATUS_LABELS[record.status]}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {can('units.update') ? (
              isOccupied ? (
                <p className="text-xs text-muted-foreground">
                  Occupied units follow their lease. End the lease to change this.
                </p>
              ) : (
                <Select
                  value={record.status}
                  disabled={setStatus.isPending}
                  onValueChange={async (value) => {
                    try {
                      await setStatus.mutateAsync({ id: record.id, body: { status: value } });
                      toast.success('Unit status updated.');
                    } catch (error) {
                      toast.error(
                        error instanceof ApiError ? error.message : 'Could not update the status.',
                      );
                    }
                  }}
                >
                  <SelectTrigger aria-label="Unit status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SETTABLE_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {UNIT_STATUS_LABELS[status]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Water meter</dt>
              <dd className="text-sm">{record.waterMeterNumber ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Electricity meter
              </dt>
              <dd className="text-sm">{record.electricityMeterNumber ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Added</dt>
              <dd className="text-sm">{formatDate(record.createdAt)}</dd>
            </div>
            {record.description ? (
              <div className="sm:col-span-2 lg:col-span-3">
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Description
                </dt>
                <dd className="text-sm">{record.description}</dd>
              </div>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      <UnitFormDialog open={editOpen} onOpenChange={setEditOpen} unit={record} />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        destructive
        title={`Delete unit ${record.unitNumber}?`}
        description={
          isOccupied
            ? 'This unit is occupied and cannot be deleted. End the lease first.'
            : 'This permanently removes the unit. It cannot be undone.'
        }
        confirmLabel="Delete unit"
        loading={remove.isPending}
        onConfirm={async () => {
          try {
            await remove.mutateAsync(record.id);
            toast.success('Unit deleted.');
            setDeleteOpen(false);
            router.push(`/properties/${record.propertyId}`);
          } catch (error) {
            toast.error(error instanceof ApiError ? error.message : 'Could not delete the unit.');
          }
        }}
      />
    </>
  );
}

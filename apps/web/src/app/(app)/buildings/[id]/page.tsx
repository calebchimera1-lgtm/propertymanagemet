'use client';

import { DoorClosed, Pencil, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { CardSkeleton, EmptyState, ErrorState, TableSkeleton } from '@/components/states';
import { type Column, DataTable } from '@/components/data-table/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useSession } from '@/features/auth/use-session';
import { BuildingFormDialog } from '@/features/portfolio/components/building-form-dialog';
import { UnitFormDialog } from '@/features/portfolio/components/unit-form-dialog';
import {
  UNIT_STATUS_LABELS,
  UNIT_STATUS_VARIANTS,
  UNIT_TYPE_LABELS,
} from '@/features/portfolio/labels';
import { useBuilding, useBuildingMutations, useUnits } from '@/features/portfolio/queries';
import type { Unit } from '@/features/portfolio/types';
import { ApiError } from '@/lib/api-client';
import { formatMoney } from '@/lib/utils';

export default function BuildingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can, me } = useSession();

  const building = useBuilding(id);
  const units = useUnits({ buildingId: id, limit: 100, sortBy: 'unitNumber', sortOrder: 'asc' });
  const { remove } = useBuildingMutations();

  const [editOpen, setEditOpen] = useState(false);
  const [unitOpen, setUnitOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (building.isLoading) return <CardSkeleton count={2} />;

  if (building.isError || !building.data) {
    return (
      <ErrorState
        title="Building unavailable"
        description={
          building.error instanceof ApiError && building.error.status === 404
            ? 'This building does not exist, or it is not one you have access to.'
            : 'The building could not be loaded.'
        }
        onRetry={() => void building.refetch()}
      />
    );
  }

  const record = building.data;
  const currency = me?.organization.currency ?? 'KES';

  const columns: Column<Unit>[] = [
    { header: 'Unit', cell: (unit) => <span className="font-medium">{unit.unitNumber}</span> },
    { header: 'Type', cell: (unit) => UNIT_TYPE_LABELS[unit.unitType] },
    { header: 'Floor', cell: (unit) => unit.floor ?? '—' },
    {
      header: 'Rent',
      cell: (unit) => (
        <span className="tabular-nums">{formatMoney(unit.monthlyRent, currency)}</span>
      ),
    },
    {
      header: 'Status',
      cell: (unit) => (
        <Badge variant={UNIT_STATUS_VARIANTS[unit.status]}>{UNIT_STATUS_LABELS[unit.status]}</Badge>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={record.name}
        description={
          <>
            Part of{' '}
            <Link href={`/properties/${record.propertyId}`} className="text-primary hover:underline">
              {record.property.name}
            </Link>
          </>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {can('buildings.update') ? (
              <Button variant="outline" onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" aria-hidden />
                Edit
              </Button>
            ) : null}
            {can('buildings.delete') ? (
              <Button variant="ghost" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="h-4 w-4 text-destructive" aria-hidden />
                <span className="text-destructive">Delete</span>
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Units</CardDescription>
            <CardTitle className="text-2xl">{record.unitCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Floors</CardDescription>
            <CardTitle className="text-2xl">{record.floors ?? '—'}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Status</CardDescription>
            <CardTitle className="text-2xl capitalize">{record.status.toLowerCase()}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {record.description ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            {record.description}
          </CardContent>
        </Card>
      ) : null}

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Units</h2>
        {can('units.create') ? (
          <Button size="sm" onClick={() => setUnitOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            Add unit
          </Button>
        ) : null}
      </div>

      {units.isLoading ? (
        <TableSkeleton rows={4} columns={5} />
      ) : (units.data?.data.length ?? 0) === 0 ? (
        <EmptyState
          icon={DoorClosed}
          title="No units in this building"
          description="Add the rentable units in this block, with their monthly rent."
        />
      ) : (
        <DataTable
          rows={units.data?.data ?? []}
          columns={columns}
          rowKey={(unit) => unit.id}
          onRowClick={(unit) => router.push(`/units/${unit.id}`)}
        />
      )}

      <BuildingFormDialog open={editOpen} onOpenChange={setEditOpen} building={record} />
      <UnitFormDialog
        open={unitOpen}
        onOpenChange={setUnitOpen}
        lockedPropertyId={record.propertyId}
        lockedBuildingId={record.id}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        destructive
        title={`Delete ${record.name}?`}
        description={
          record.unitCount > 0
            ? `Its ${record.unitCount} unit${record.unitCount === 1 ? '' : 's'} will not be deleted — they move to ${record.property.name} and keep all their history.`
            : 'This permanently removes the building. It cannot be undone.'
        }
        confirmLabel="Delete building"
        loading={remove.isPending}
        onConfirm={async () => {
          try {
            const result = await remove.mutateAsync(record.id);
            toast.success(
              result.detachedUnits > 0
                ? `Building deleted. ${result.detachedUnits} unit(s) moved to ${record.property.name}.`
                : 'Building deleted.',
            );
            setDeleteOpen(false);
            router.push(`/properties/${record.propertyId}`);
          } catch (error) {
            toast.error(error instanceof ApiError ? error.message : 'Could not delete.');
          }
        }}
      />
    </>
  );
}

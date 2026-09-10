'use client';

import { Archive, Building2, DoorClosed, Pencil, Plus, Trash2 } from 'lucide-react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSession } from '@/features/auth/use-session';
import { BuildingFormDialog } from '@/features/portfolio/components/building-form-dialog';
import { PropertyFormDialog } from '@/features/portfolio/components/property-form-dialog';
import { UnitFormDialog } from '@/features/portfolio/components/unit-form-dialog';
import {
  PROPERTY_STATUS_LABELS,
  PROPERTY_STATUS_VARIANTS,
  PROPERTY_TYPE_LABELS,
  UNIT_STATUS_LABELS,
  UNIT_STATUS_VARIANTS,
  UNIT_TYPE_LABELS,
} from '@/features/portfolio/labels';
import {
  useBuildings,
  useProperty,
  usePropertyMutations,
  usePropertySummary,
  useUnits,
} from '@/features/portfolio/queries';
import type { Building, Unit } from '@/features/portfolio/types';
import { ApiError } from '@/lib/api-client';
import { formatMoney } from '@/lib/utils';

export default function PropertyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can, me } = useSession();

  const property = useProperty(id);
  const summary = usePropertySummary(id);
  const buildings = useBuildings({ propertyId: id, limit: 50, sortBy: 'name', sortOrder: 'asc' });
  const units = useUnits({ propertyId: id, limit: 100, sortBy: 'unitNumber', sortOrder: 'asc' });
  const { archive, remove } = usePropertyMutations();

  const [editOpen, setEditOpen] = useState(false);
  const [buildingOpen, setBuildingOpen] = useState(false);
  const [unitOpen, setUnitOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (property.isLoading) return <CardSkeleton count={3} />;

  if (property.isError) {
    return (
      <ErrorState
        title="Property unavailable"
        description={
          property.error instanceof ApiError && property.error.status === 404
            ? 'This property does not exist, or it is not one you have access to.'
            : 'The property could not be loaded.'
        }
        onRetry={() => void property.refetch()}
      />
    );
  }

  const record = property.data;
  if (!record) return null;
  const currency = me?.organization.currency ?? 'KES';

  const buildingColumns: Column<Building>[] = [
    { header: 'Name', cell: (building) => <span className="font-medium">{building.name}</span> },
    { header: 'Floors', cell: (building) => building.floors ?? '—' },
    { header: 'Units', cell: (building) => building.unitCount },
  ];

  const unitColumns: Column<Unit>[] = [
    { header: 'Unit', cell: (unit) => <span className="font-medium">{unit.unitNumber}</span> },
    { header: 'Building', cell: (unit) => unit.building?.name ?? 'Direct' },
    { header: 'Type', cell: (unit) => UNIT_TYPE_LABELS[unit.unitType] },
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
        description={[
          PROPERTY_TYPE_LABELS[record.propertyType],
          record.addressLine,
          record.city,
          record.county,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <div className="flex flex-wrap gap-2">
            {can('properties.update') ? (
              <Button variant="outline" onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" aria-hidden />
                Edit
              </Button>
            ) : null}
            {can('properties.update') && record.status !== 'ARCHIVED' ? (
              <Button variant="outline" onClick={() => setArchiveOpen(true)}>
                <Archive className="h-4 w-4" aria-hidden />
                Archive
              </Button>
            ) : null}
            {can('properties.delete') ? (
              <Button variant="ghost" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="h-4 w-4 text-destructive" aria-hidden />
                <span className="text-destructive">Delete</span>
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={PROPERTY_STATUS_VARIANTS[record.status]}>
          {PROPERTY_STATUS_LABELS[record.status]}
        </Badge>
        <span className="text-sm text-muted-foreground">
          {record.buildingCount} building{record.buildingCount === 1 ? '' : 's'} ·{' '}
          {record.unitCount} unit{record.unitCount === 1 ? '' : 's'}
        </span>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="buildings">Buildings</TabsTrigger>
          <TabsTrigger value="units">Units</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          {summary.isLoading ? (
            <CardSkeleton count={3} />
          ) : summary.data ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Units</CardDescription>
                  <CardTitle className="text-2xl">{summary.data.units.total}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {summary.data.units.vacant} vacant · {summary.data.units.occupied} occupied
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Occupancy</CardDescription>
                  <CardTitle className="text-2xl">{summary.data.occupancyRate}%</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  Occupied ÷ total units
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Potential monthly rent</CardDescription>
                  <CardTitle className="text-2xl tabular-nums">
                    {formatMoney(summary.data.potentialMonthlyRent, currency)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {/* Said plainly: this is what the property would bill at full
                      occupancy, not money anyone has collected — the rent screen
                      is where collections are reported. */}
                  At full occupancy. Not collected income.
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Out of service</CardDescription>
                  <CardTitle className="text-2xl">
                    {summary.data.units.maintenance + summary.data.units.unavailable}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {summary.data.units.maintenance} maintenance ·{' '}
                  {summary.data.units.unavailable} unavailable
                </CardContent>
              </Card>
            </div>
          ) : null}

          {record.description ? (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle className="text-base">About</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {record.description}
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="buildings">
          <div className="mb-4 flex justify-end">
            {can('buildings.create') ? (
              <Button size="sm" onClick={() => setBuildingOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden />
                Add building
              </Button>
            ) : null}
          </div>
          {buildings.isLoading ? (
            <TableSkeleton rows={3} columns={3} />
          ) : (buildings.data?.data.length ?? 0) === 0 ? (
            <EmptyState
              icon={Building2}
              title="No buildings yet"
              description="Add blocks if this property has more than one structure. Units can also attach directly to the property."
            />
          ) : (
            <DataTable
              rows={buildings.data?.data ?? []}
              columns={buildingColumns}
              rowKey={(building) => building.id}
              onRowClick={(building) => router.push(`/buildings/${building.id}`)}
            />
          )}
        </TabsContent>

        <TabsContent value="units">
          <div className="mb-4 flex justify-end">
            {can('units.create') ? (
              <Button size="sm" onClick={() => setUnitOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden />
                Add unit
              </Button>
            ) : null}
          </div>
          {units.isLoading ? (
            <TableSkeleton rows={5} columns={5} />
          ) : (units.data?.data.length ?? 0) === 0 ? (
            <EmptyState
              icon={DoorClosed}
              title="No units yet"
              description="Add the rentable units in this property, with their monthly rent."
            />
          ) : (
            <DataTable
              rows={units.data?.data ?? []}
              columns={unitColumns}
              rowKey={(unit) => unit.id}
              onRowClick={(unit) => router.push(`/units/${unit.id}`)}
            />
          )}
        </TabsContent>
      </Tabs>

      <PropertyFormDialog open={editOpen} onOpenChange={setEditOpen} property={record} />
      <BuildingFormDialog
        open={buildingOpen}
        onOpenChange={setBuildingOpen}
        lockedPropertyId={record.id}
      />
      <UnitFormDialog open={unitOpen} onOpenChange={setUnitOpen} lockedPropertyId={record.id} />

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={`Archive ${record.name}?`}
        description="Archiving hides the property from the default list but keeps every building, unit and record attached to it. You can set it back to active at any time."
        confirmLabel="Archive property"
        loading={archive.isPending}
        onConfirm={async () => {
          try {
            await archive.mutateAsync(record.id);
            toast.success('Property archived.');
            setArchiveOpen(false);
          } catch (error) {
            toast.error(error instanceof ApiError ? error.message : 'Could not archive.');
          }
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        destructive
        title={`Delete ${record.name}?`}
        description={
          record.unitCount > 0 || record.buildingCount > 0
            ? `This property still has ${record.buildingCount} building(s) and ${record.unitCount} unit(s), so it cannot be deleted. Archive it instead.`
            : 'This permanently removes the property. It cannot be undone.'
        }
        confirmLabel="Delete permanently"
        loading={remove.isPending}
        onConfirm={async () => {
          try {
            await remove.mutateAsync(record.id);
            toast.success('Property deleted.');
            setDeleteOpen(false);
            router.push('/properties');
          } catch (error) {
            toast.error(
              error instanceof ApiError ? error.message : 'Could not delete the property.',
            );
          }
        }}
      />
    </>
  );
}

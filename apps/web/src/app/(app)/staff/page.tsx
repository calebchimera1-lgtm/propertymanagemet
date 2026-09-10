'use client';

import { Building2, Pencil, Plus, Power, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/states';
import { type Column, DataTable } from '@/components/data-table/data-table';
import { DataTablePagination } from '@/components/data-table/pagination';
import { DataTableToolbar, FilterSelect } from '@/components/data-table/toolbar';
import { useTableParams } from '@/components/data-table/use-table-params';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useSession } from '@/features/auth/use-session';
import { AssignPropertiesDialog } from '@/features/operations/components/assign-properties-dialog';
import { StaffFormDialog } from '@/features/operations/components/staff-form-dialog';
import {
  ASSIGNABLE_ROLES,
  ROLE_LABELS,
  STAFF_STATUS_LABELS,
  STAFF_STATUS_VARIANTS,
  isScopedRole,
} from '@/features/operations/labels';
import { useStaffList, useStaffMutations } from '@/features/operations/queries';
import type { StaffMember } from '@/features/operations/types';
import { ApiError } from '@/lib/api-client';
import { formatDate } from '@/lib/utils';

export default function StaffPage() {
  const { can, me } = useSession();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<StaffMember | undefined>(undefined);
  const [assigning, setAssigning] = useState<StaffMember | null>(null);
  const [deactivating, setDeactivating] = useState<StaffMember | null>(null);
  const [deleting, setDeleting] = useState<StaffMember | null>(null);

  const table = useTableParams({ sortBy: 'createdAt', sortOrder: 'desc' });
  const { data, isLoading, isError, error, refetch } = useStaffList(table.query);
  const { setActive, remove } = useStaffMutations();

  const hasFilters = Boolean(table.search || table.filters.role || table.filters.status);
  const isSelf = (member: StaffMember) => member.id === me?.user.id;

  const columns: Column<StaffMember>[] = [
    {
      header: 'Name',
      sortKey: 'fullName',
      cell: (member) => (
        <div className="min-w-0">
          <div className="truncate font-medium">
            {member.fullName}
            {isSelf(member) ? <span className="text-muted-foreground"> (you)</span> : null}
          </div>
          <div className="truncate text-xs text-muted-foreground">{member.email}</div>
        </div>
      ),
    },
    {
      header: 'Role',
      cell: (member) => (
        <div>
          <div>{member.roleLabels[0] ?? ROLE_LABELS[member.roles[0] ?? ''] ?? '—'}</div>
          {member.properties === null ? (
            <div className="text-xs text-muted-foreground">All properties</div>
          ) : member.properties.length === 0 ? (
            // Spelled out rather than shown as a blank: "no access" and "not
            // loaded" must not look the same.
            <div className="text-xs text-destructive">No properties assigned</div>
          ) : (
            <div className="text-xs text-muted-foreground">
              {member.properties.length} propert{member.properties.length === 1 ? 'y' : 'ies'}
            </div>
          )}
        </div>
      ),
    },
    {
      header: 'Status',
      cell: (member) => (
        <Badge variant={STAFF_STATUS_VARIANTS[member.status]}>
          {STAFF_STATUS_LABELS[member.status]}
        </Badge>
      ),
    },
    {
      header: 'Last signed in',
      sortKey: 'lastLoginAt',
      cell: (member) =>
        member.lastLoginAt ? (
          formatDate(member.lastLoginAt)
        ) : (
          <span className="text-muted-foreground">Never</span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Staff"
        description="Who works here, what they may do, and which properties they may see."
        actions={
          can('staff.create') ? (
            <Button
              onClick={() => {
                setEditing(undefined);
                setFormOpen(true);
              }}
            >
              <Plus className="h-4 w-4" aria-hidden />
              Invite staff
            </Button>
          ) : null
        }
      />

      <Alert variant="info">
        <AlertDescription>
          Email is not delivered in this version. Inviting someone produces a one-time link shown to
          you once, which you pass on yourself. Nothing here claims to have sent a message.
        </AlertDescription>
      </Alert>

      <DataTableToolbar
        search={table.search}
        onSearchChange={table.onSearchChange}
        searchPlaceholder="Search name or email"
        hasFilters={hasFilters}
        onClear={() => {
          table.onSearchChange('');
          table.setFilter('role', undefined);
          table.setFilter('status', undefined);
        }}
      >
        <FilterSelect
          label="Role"
          value={table.filters.role}
          onChange={(value) => table.setFilter('role', value)}
          options={ASSIGNABLE_ROLES.map((value) => ({ value, label: ROLE_LABELS[value] ?? value }))}
          allLabel="All roles"
        />
        <FilterSelect
          label="Status"
          value={table.filters.status}
          onChange={(value) => table.setFilter('status', value)}
          options={(Object.keys(STAFF_STATUS_LABELS) as (keyof typeof STAFF_STATUS_LABELS)[]).map(
            (value) => ({ value, label: STAFF_STATUS_LABELS[value] }),
          )}
          allLabel="All statuses"
        />
      </DataTableToolbar>

      {isLoading ? (
        <TableSkeleton rows={5} columns={4} />
      ) : isError ? (
        <ErrorState
          description={error instanceof ApiError ? error.message : 'Staff could not be loaded.'}
          onRetry={() => void refetch()}
        />
      ) : !data || data.data.length === 0 ? (
        <EmptyState
          icon={Users}
          title={hasFilters ? 'Nobody matches these filters' : 'No staff yet'}
          description={
            hasFilters
              ? 'Try a different search or clear the filters.'
              : 'Invite the people who work with you, and choose which properties each of them can see.'
          }
        />
      ) : (
        <>
          <DataTable
            rows={data.data}
            columns={columns}
            rowKey={(member) => member.id}
            sortBy={table.sortBy}
            sortOrder={table.sortOrder}
            onSort={table.toggleSort}
            rowActions={(member) => (
              <div className="flex flex-wrap gap-2">
                {can('staff.update') && isScopedRole(member.roles[0] ?? '') ? (
                  <Button variant="outline" size="sm" onClick={() => setAssigning(member)}>
                    <Building2 className="h-4 w-4" aria-hidden />
                    Properties
                  </Button>
                ) : null}
                {can('staff.update') ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditing(member);
                      setFormOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                    <span className="sr-only sm:not-sr-only">Edit</span>
                  </Button>
                ) : null}
                {/* Deactivating yourself is refused by the API; not offering
                    the button is the honest version of the same rule. */}
                {can('staff.update') && !isSelf(member) ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      member.status === 'ACTIVE'
                        ? setDeactivating(member)
                        : void setActive
                            .mutateAsync({ id: member.id, active: true })
                            .then(() => toast.success(`${member.fullName} can sign in again.`))
                            .catch((mutationError: unknown) =>
                              toast.error(
                                mutationError instanceof ApiError
                                  ? mutationError.message
                                  : 'Could not update access.',
                              ),
                            )
                    }
                  >
                    <Power className="h-4 w-4" aria-hidden />
                    <span className="sr-only sm:not-sr-only">
                      {member.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                    </span>
                  </Button>
                ) : null}
                {can('staff.delete') && !isSelf(member) ? (
                  <Button variant="ghost" size="sm" onClick={() => setDeleting(member)}>
                    <Trash2 className="h-4 w-4 text-destructive" aria-hidden />
                    <span className="sr-only">Delete</span>
                  </Button>
                ) : null}
              </div>
            )}
          />
          <DataTablePagination meta={data.meta} onPageChange={table.setPage} noun="person" />
        </>
      )}

      <StaffFormDialog open={formOpen} onOpenChange={setFormOpen} staff={editing} />

      {assigning ? (
        <AssignPropertiesDialog
          open={Boolean(assigning)}
          onOpenChange={(open) => !open && setAssigning(null)}
          staff={assigning}
        />
      ) : null}

      {deactivating ? (
        <ConfirmDialog
          open={Boolean(deactivating)}
          onOpenChange={(open) => !open && setDeactivating(null)}
          title={`Deactivate ${deactivating.fullName}?`}
          description="They will be signed out everywhere immediately and cannot sign back in. Their history stays intact, and you can reactivate them later."
          confirmLabel="Deactivate"
          destructive
          loading={setActive.isPending}
          onConfirm={async () => {
            try {
              await setActive.mutateAsync({ id: deactivating.id, active: false });
              toast.success(`${deactivating.fullName} has been deactivated.`);
              setDeactivating(null);
            } catch (mutationError) {
              toast.error(
                mutationError instanceof ApiError
                  ? mutationError.message
                  : 'Could not deactivate this person.',
              );
            }
          }}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          open={Boolean(deleting)}
          onOpenChange={(open) => !open && setDeleting(null)}
          title={`Delete ${deleting.fullName}?`}
          description="This removes the account entirely. It only works for someone with no recorded history — anyone who has handled money or appears in the audit trail must be deactivated instead."
          confirmLabel="Delete account"
          destructive
          loading={remove.isPending}
          onConfirm={async () => {
            try {
              await remove.mutateAsync(deleting.id);
              toast.success('Account deleted.');
              setDeleting(null);
            } catch (mutationError) {
              toast.error(
                mutationError instanceof ApiError
                  ? mutationError.message
                  : 'Could not delete this account.',
              );
            }
          }}
        />
      ) : null}
    </>
  );
}

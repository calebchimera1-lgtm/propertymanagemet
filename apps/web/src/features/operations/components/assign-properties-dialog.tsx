'use client';

import { useEffect, useState } from 'react';
import type * as React from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FormDialog } from '@/features/portfolio/components/form-dialog';
import { useProperties } from '@/features/portfolio/queries';
import { ApiError } from '@/lib/api-client';
import { ROLE_LABELS } from '../labels';
import { useStaffMutations, useStaffProperties } from '../queries';
import type { StaffMember } from '../types';

/**
 * Which properties a scoped staff member may see.
 *
 * The whole set is replaced on save, which is why the empty state has to be
 * spelled out: unticking everything is a real instruction meaning "sees
 * nothing", not a half-finished form.
 */
export function AssignPropertiesDialog({
  open,
  onOpenChange,
  staff,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staff: StaffMember;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const { assignProperties } = useStaffMutations();

  const properties = useProperties({ limit: 100, sortBy: 'name', sortOrder: 'asc' });
  const current = useStaffProperties(staff.id, open);

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    setSelected((current.data?.properties ?? staff.properties ?? []).map((p) => p.id));
  }, [open, current.data, staff.properties]);

  const total = properties.data?.meta.total ?? 0;
  const shown = properties.data?.data.length ?? 0;

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    try {
      await assignProperties.mutateAsync({ id: staff.id, propertyIds: selected });
      toast.success(
        selected.length === 0
          ? `${staff.fullName} now sees no properties.`
          : `${staff.fullName} now sees ${selected.length} propert${selected.length === 1 ? 'y' : 'ies'}.`,
      );
      onOpenChange(false);
    } catch (error) {
      setFormError(
        error instanceof ApiError ? error.message : 'Could not save the assignments. Please try again.',
      );
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Properties for ${staff.fullName}`}
      description={`${ROLE_LABELS[staff.roles[0] ?? ''] ?? 'This person'} sees only what is ticked here. Takes effect on their next page load.`}
      formError={formError}
      submitting={assignProperties.isPending}
      submitLabel="Save assignments"
      onSubmit={onSubmit}
    >
      {properties.isError ? (
        <Alert variant="destructive">
          <AlertDescription>
            The property list could not be loaded, so this is showing none — that is a failed
            request, not an empty portfolio. Close this and try again.
          </AlertDescription>
        </Alert>
      ) : null}

      {selected.length === 0 && !properties.isError ? (
        <Alert variant="warning">
          <AlertDescription>
            Nothing is ticked. Saving now means {staff.fullName} can sign in but will see no
            properties, tenants, rent or maintenance at all.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border p-2">
        {(properties.data?.data ?? []).map((property) => {
          const checked = selected.includes(property.id);
          return (
            <label
              key={property.id}
              className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted/50"
            >
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-input"
                checked={checked}
                onChange={() =>
                  setSelected((ids) =>
                    checked ? ids.filter((id) => id !== property.id) : [...ids, property.id],
                  )
                }
              />
              <span className="min-w-0">
                <span className="block truncate font-medium">{property.name}</span>
                {property.city ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    {property.city}
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
        {shown === 0 && !properties.isLoading && !properties.isError ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            There are no properties to assign yet.
          </p>
        ) : null}
      </div>

      {total > shown ? (
        <p className="text-xs text-muted-foreground">
          Showing the first {shown} of {total} properties.
        </p>
      ) : null}
    </FormDialog>
  );
}

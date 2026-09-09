'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api-client';
import { useBuildingMutations, useProperties } from '../queries';
import { type BuildingFormValues, buildingFormSchema, toPayload } from '../schemas';
import type { Building } from '../types';
import { FormDialog, applyFieldErrors } from './form-dialog';

const FIELDS = ['propertyId', 'name', 'floors', 'description'];

export function BuildingFormDialog({
  open,
  onOpenChange,
  building,
  lockedPropertyId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  building?: Building;
  /** Set when adding from inside a property, so the parent cannot be changed. */
  lockedPropertyId?: string;
}) {
  const isEdit = Boolean(building);
  const [formError, setFormError] = useState<string | null>(null);
  const { create, update } = useBuildingMutations();

  // Only needed for the picker; skipped entirely when the parent is fixed.
  const properties = useProperties({ limit: 100, sortBy: 'name', sortOrder: 'asc' });

  const form = useForm<BuildingFormValues>({
    resolver: zodResolver(buildingFormSchema),
    defaultValues: { propertyId: lockedPropertyId ?? '', name: '', floors: '', description: '' },
  });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    form.reset({
      propertyId: building?.propertyId ?? lockedPropertyId ?? '',
      name: building?.name ?? '',
      floors: building?.floors != null ? String(building.floors) : '',
      description: building?.description ?? '',
    });
  }, [open, building, lockedPropertyId, form]);

  const submitting = create.isPending || update.isPending;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const payload = toPayload(values, ['floors']);

    try {
      if (building) {
        // The parent property is deliberately not updatable: moving a building
        // would relocate every unit beneath it.
        const { propertyId: _omit, ...body } = payload;
        await update.mutateAsync({ id: building.id, body });
        toast.success('Building updated.');
      } else {
        await create.mutateAsync(payload);
        toast.success('Building created.');
      }
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError) {
        const attached = applyFieldErrors(error.fieldErrors, form.setError, FIELDS);
        if (!attached) setFormError(error.message);
        return;
      }
      setFormError('Could not save the building. Please try again.');
    }
  });

  const propertyLocked = Boolean(lockedPropertyId) || isEdit;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? 'Edit building' : 'Add a building'}
      description={
        isEdit
          ? 'Update this building’s details. Its property cannot be changed.'
          : 'A building is a block within a property — "Block A", "Palm Wing".'
      }
      formError={formError}
      submitting={submitting}
      submitLabel={isEdit ? 'Save changes' : 'Create building'}
      onSubmit={onSubmit}
    >
      <FormField
        label="Property"
        htmlFor="propertyId"
        error={form.formState.errors.propertyId?.message}
        hint={propertyLocked ? 'A building cannot be moved between properties.' : undefined}
        required
      >
        <Select
          value={form.watch('propertyId')}
          disabled={propertyLocked}
          onValueChange={(value) => form.setValue('propertyId', value, { shouldDirty: true })}
        >
          <SelectTrigger id="propertyId">
            <SelectValue placeholder="Choose a property" />
          </SelectTrigger>
          <SelectContent>
            {(properties.data?.data ?? []).map((property) => (
              <SelectItem key={property.id} value={property.id}>
                {property.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>

      <FormField label="Name" htmlFor="name" error={form.formState.errors.name?.message} required>
        <Input placeholder="Block A" {...form.register('name')} />
      </FormField>

      <FormField label="Floors" htmlFor="floors" error={form.formState.errors.floors?.message}>
        <Input type="number" min={1} max={200} placeholder="4" {...form.register('floors')} />
      </FormField>

      <FormField
        label="Description"
        htmlFor="description"
        error={form.formState.errors.description?.message}
      >
        <Textarea rows={3} {...form.register('description')} />
      </FormField>
    </FormDialog>
  );
}

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
import { UNIT_TYPE_LABELS, selectOptions } from '../labels';
import { useBuildings, useProperties, useUnitMutations } from '../queries';
import { type UnitFormValues, toPayload, unitFormSchema } from '../schemas';
import type { Unit } from '../types';
import { FormDialog, applyFieldErrors } from './form-dialog';

const FIELDS = [
  'propertyId',
  'buildingId',
  'unitNumber',
  'unitType',
  'monthlyRent',
  'securityDeposit',
  'floor',
  'bedrooms',
  'bathrooms',
];

const NO_BUILDING = '__none__';

export function UnitFormDialog({
  open,
  onOpenChange,
  unit,
  lockedPropertyId,
  lockedBuildingId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  unit?: Unit;
  lockedPropertyId?: string;
  lockedBuildingId?: string;
}) {
  const isEdit = Boolean(unit);
  const [formError, setFormError] = useState<string | null>(null);
  const { create, update } = useUnitMutations();

  const properties = useProperties({ limit: 100, sortBy: 'name', sortOrder: 'asc' });

  const form = useForm<UnitFormValues>({
    resolver: zodResolver(unitFormSchema),
    defaultValues: {
      propertyId: lockedPropertyId ?? '',
      buildingId: lockedBuildingId ?? '',
      unitNumber: '',
      unitType: 'ONE_BEDROOM',
      monthlyRent: '',
      securityDeposit: '',
      floor: '',
      bedrooms: '',
      bathrooms: '',
      waterMeterNumber: '',
      electricityMeterNumber: '',
      description: '',
    },
  });

  const propertyId = form.watch('propertyId');

  // The building list follows the chosen property: offering a building from a
  // different property would only produce a 422 from the API.
  const buildings = useBuildings(
    { propertyId, limit: 100, sortBy: 'name', sortOrder: 'asc' },
    Boolean(propertyId),
  );

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    form.reset({
      propertyId: unit?.propertyId ?? lockedPropertyId ?? '',
      buildingId: unit?.buildingId ?? lockedBuildingId ?? '',
      unitNumber: unit?.unitNumber ?? '',
      unitType: unit?.unitType ?? 'ONE_BEDROOM',
      monthlyRent: unit?.monthlyRent ?? '',
      securityDeposit: unit?.securityDeposit ?? '',
      floor: unit?.floor != null ? String(unit.floor) : '',
      bedrooms: unit?.bedrooms != null ? String(unit.bedrooms) : '',
      bathrooms: unit?.bathrooms != null ? String(unit.bathrooms) : '',
      waterMeterNumber: unit?.waterMeterNumber ?? '',
      electricityMeterNumber: unit?.electricityMeterNumber ?? '',
      description: unit?.description ?? '',
    });
  }, [open, unit, lockedPropertyId, lockedBuildingId, form]);

  const submitting = create.isPending || update.isPending;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    // Money stays a string; only genuinely integer fields are converted.
    const payload = toPayload(values, ['floor', 'bedrooms', 'bathrooms']);

    try {
      if (unit) {
        const { propertyId: _omit, ...body } = payload;
        await update.mutateAsync({ id: unit.id, body });
        toast.success('Unit updated.');
      } else {
        await create.mutateAsync(payload);
        toast.success('Unit created.');
      }
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError) {
        const attached = applyFieldErrors(error.fieldErrors, form.setError, FIELDS);
        if (!attached) setFormError(error.message);
        return;
      }
      setFormError('Could not save the unit. Please try again.');
    }
  });

  const propertyLocked = Boolean(lockedPropertyId) || isEdit;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? `Edit unit ${unit?.unitNumber}` : 'Add a unit'}
      description={
        isEdit ? 'Update this unit’s details.' : 'A unit is the rentable thing a tenant occupies.'
      }
      formError={formError}
      submitting={submitting}
      submitLabel={isEdit ? 'Save changes' : 'Create unit'}
      onSubmit={onSubmit}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Property"
          htmlFor="propertyId"
          error={form.formState.errors.propertyId?.message}
          hint={propertyLocked ? 'A unit cannot be moved between properties.' : undefined}
          required
        >
          <Select
            value={form.watch('propertyId')}
            disabled={propertyLocked}
            onValueChange={(value) => {
              form.setValue('propertyId', value, { shouldDirty: true });
              // The previously chosen building belongs to the old property.
              form.setValue('buildingId', '', { shouldDirty: true });
            }}
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

        <FormField
          label="Building"
          htmlFor="buildingId"
          error={form.formState.errors.buildingId?.message}
          hint="Leave as none for a unit that sits directly under the property."
        >
          <Select
            value={form.watch('buildingId') || NO_BUILDING}
            disabled={!propertyId || Boolean(lockedBuildingId)}
            onValueChange={(value) =>
              form.setValue('buildingId', value === NO_BUILDING ? '' : value, { shouldDirty: true })
            }
          >
            <SelectTrigger id="buildingId">
              <SelectValue placeholder="None" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_BUILDING}>None</SelectItem>
              {(buildings.data?.data ?? []).map((building) => (
                <SelectItem key={building.id} value={building.id}>
                  {building.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        <FormField
          label="Unit number"
          htmlFor="unitNumber"
          error={form.formState.errors.unitNumber?.message}
          required
        >
          <Input placeholder="A12" {...form.register('unitNumber')} />
        </FormField>

        <FormField
          label="Type"
          htmlFor="unitType"
          error={form.formState.errors.unitType?.message}
          required
        >
          <Select
            value={form.watch('unitType')}
            onValueChange={(value) =>
              form.setValue('unitType', value as UnitFormValues['unitType'], { shouldDirty: true })
            }
          >
            <SelectTrigger id="unitType">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {selectOptions(UNIT_TYPE_LABELS).map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        <FormField
          label="Monthly rent"
          htmlFor="monthlyRent"
          error={form.formState.errors.monthlyRent?.message}
          hint="Amount only, e.g. 32000"
          required
        >
          {/* inputMode numeric, but the value stays a string end to end. */}
          <Input inputMode="decimal" placeholder="32000" {...form.register('monthlyRent')} />
        </FormField>

        <FormField
          label="Security deposit"
          htmlFor="securityDeposit"
          error={form.formState.errors.securityDeposit?.message}
        >
          <Input inputMode="decimal" placeholder="32000" {...form.register('securityDeposit')} />
        </FormField>

        <FormField label="Floor" htmlFor="floor" error={form.formState.errors.floor?.message}>
          <Input type="number" {...form.register('floor')} />
        </FormField>

        <FormField
          label="Bedrooms"
          htmlFor="bedrooms"
          error={form.formState.errors.bedrooms?.message}
        >
          <Input type="number" min={0} {...form.register('bedrooms')} />
        </FormField>

        <FormField
          label="Bathrooms"
          htmlFor="bathrooms"
          error={form.formState.errors.bathrooms?.message}
        >
          <Input type="number" min={0} {...form.register('bathrooms')} />
        </FormField>

        <FormField label="Water meter" htmlFor="waterMeterNumber">
          <Input {...form.register('waterMeterNumber')} />
        </FormField>

        <FormField label="Electricity meter" htmlFor="electricityMeterNumber">
          <Input {...form.register('electricityMeterNumber')} />
        </FormField>
      </div>

      <FormField label="Description" htmlFor="description">
        <Textarea rows={2} {...form.register('description')} />
      </FormField>
    </FormDialog>
  );
}

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
import { PROPERTY_TYPE_LABELS, selectOptions } from '../labels';
import { usePropertyMutations } from '../queries';
import { type PropertyFormValues, propertyFormSchema, toPayload } from '../schemas';
import type { Property } from '../types';
import { FormDialog, applyFieldErrors } from './form-dialog';

const FIELDS = ['name', 'propertyType', 'addressLine', 'city', 'county', 'country', 'description'];

export function PropertyFormDialog({
  open,
  onOpenChange,
  property,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing; absent when creating. */
  property?: Property;
}) {
  const isEdit = Boolean(property);
  const [formError, setFormError] = useState<string | null>(null);
  const { create, update } = usePropertyMutations();

  const form = useForm<PropertyFormValues>({
    resolver: zodResolver(propertyFormSchema),
    defaultValues: {
      name: '',
      propertyType: 'RESIDENTIAL',
      addressLine: '',
      city: '',
      county: '',
      country: 'Kenya',
      description: '',
    },
  });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    form.reset({
      name: property?.name ?? '',
      propertyType: property?.propertyType ?? 'RESIDENTIAL',
      addressLine: property?.addressLine ?? '',
      city: property?.city ?? '',
      county: property?.county ?? '',
      country: property?.country ?? 'Kenya',
      description: property?.description ?? '',
    });
  }, [open, property, form]);

  const submitting = create.isPending || update.isPending;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const body = toPayload(values);

    try {
      if (property) {
        await update.mutateAsync({ id: property.id, body });
        toast.success('Property updated.');
      } else {
        await create.mutateAsync(body);
        toast.success('Property created.');
      }
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError) {
        const attached = applyFieldErrors(error.fieldErrors, form.setError, FIELDS);
        if (!attached) setFormError(error.message);
        return;
      }
      setFormError('Could not save the property. Please try again.');
    }
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? 'Edit property' : 'Add a property'}
      description={
        isEdit
          ? 'Update this property’s details.'
          : 'A property is a site: an estate, a block of flats, a row of shops.'
      }
      formError={formError}
      submitting={submitting}
      submitLabel={isEdit ? 'Save changes' : 'Create property'}
      onSubmit={onSubmit}
    >
      <FormField label="Name" htmlFor="name" error={form.formState.errors.name?.message} required>
        <Input placeholder="Sunrise Estate" {...form.register('name')} />
      </FormField>

      <FormField
        label="Type"
        htmlFor="propertyType"
        error={form.formState.errors.propertyType?.message}
        required
      >
        <Select
          value={form.watch('propertyType')}
          onValueChange={(value) =>
            form.setValue('propertyType', value as PropertyFormValues['propertyType'], {
              shouldDirty: true,
            })
          }
        >
          <SelectTrigger id="propertyType">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {selectOptions(PROPERTY_TYPE_LABELS).map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="City" htmlFor="city" error={form.formState.errors.city?.message}>
          <Input placeholder="Nairobi" {...form.register('city')} />
        </FormField>
        <FormField label="County" htmlFor="county" error={form.formState.errors.county?.message}>
          <Input placeholder="Nairobi" {...form.register('county')} />
        </FormField>
      </div>

      <FormField
        label="Address"
        htmlFor="addressLine"
        error={form.formState.errors.addressLine?.message}
      >
        <Input placeholder="Ngong Road" {...form.register('addressLine')} />
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

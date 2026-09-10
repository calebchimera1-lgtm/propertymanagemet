'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
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
import { FormDialog, applyFieldErrors } from '@/features/portfolio/components/form-dialog';
import { useProperties, useUnits } from '@/features/portfolio/queries';
import { ApiError } from '@/lib/api-client';
import { PRIORITY_LABELS } from '../labels';
import { useMaintenanceMutations } from '../queries';
import type { MaintenanceRequest } from '../types';

const MONEY = /^\d{1,12}(\.\d{1,2})?$/;

const schema = z.object({
  propertyId: z.string().min(1, 'Choose a property'),
  unitId: z.string().optional(),
  title: z.string().trim().min(3, 'Say what the job is').max(200),
  description: z.string().trim().min(3, 'Describe the problem').max(4000),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  estimatedCost: z
    .string()
    .trim()
    .regex(MONEY, 'Enter an amount such as 4500 or 4500.00')
    .optional()
    .or(z.literal('')),
});

type Values = z.infer<typeof schema>;
const FIELDS = ['propertyId', 'unitId', 'title', 'description', 'priority', 'estimatedCost'];

/** A "no unit" value: Radix Select cannot hold an empty string. */
const NO_UNIT = '__none__';

export function MaintenanceFormDialog({
  open,
  onOpenChange,
  request,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request?: MaintenanceRequest;
}) {
  const isEdit = Boolean(request);
  const [formError, setFormError] = useState<string | null>(null);
  const { create, update } = useMaintenanceMutations();
  const properties = useProperties({ limit: 100, sortBy: 'name', sortOrder: 'asc' });

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      propertyId: '',
      unitId: undefined,
      title: '',
      description: '',
      priority: 'MEDIUM',
      estimatedCost: '',
    },
  });

  const propertyId = form.watch('propertyId');
  // Only fetch units once a property is chosen — a unit list across the whole
  // portfolio would be long and mostly irrelevant.
  const units = useUnits(
    { propertyId, limit: 100, sortBy: 'unitNumber', sortOrder: 'asc' },
    Boolean(propertyId),
  );

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    form.reset({
      propertyId: request?.propertyId ?? '',
      unitId: request?.unitId ?? undefined,
      title: request?.title ?? '',
      description: request?.description ?? '',
      priority: request?.priority ?? 'MEDIUM',
      estimatedCost: request?.estimatedCost ?? '',
    });
  }, [open, request, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (request) {
        // Where the job is cannot change; only what it is and how urgent.
        await update.mutateAsync({
          id: request.id,
          body: {
            title: values.title,
            description: values.description,
            priority: values.priority,
            ...(values.estimatedCost ? { estimatedCost: values.estimatedCost } : {}),
          },
        });
        toast.success('Request updated.');
      } else {
        await create.mutateAsync({
          propertyId: values.propertyId,
          ...(values.unitId ? { unitId: values.unitId } : {}),
          title: values.title,
          description: values.description,
          priority: values.priority,
          ...(values.estimatedCost ? { estimatedCost: values.estimatedCost } : {}),
        });
        toast.success('Request raised.');
      }
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError) {
        const attached = applyFieldErrors(error.fieldErrors, form.setError, FIELDS);
        if (!attached) setFormError(error.message);
        return;
      }
      setFormError('Could not save the request. Please try again.');
    }
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? 'Edit request' : 'Raise a maintenance request'}
      description={
        isEdit
          ? 'The property and unit are fixed once a request exists — cancel it and raise a new one to move it.'
          : 'Work that needs doing on a property.'
      }
      formError={formError}
      submitting={create.isPending || update.isPending}
      submitLabel={isEdit ? 'Save changes' : 'Raise request'}
      onSubmit={onSubmit}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Property"
          htmlFor="propertyId"
          error={form.formState.errors.propertyId?.message}
          hint={isEdit ? 'A request cannot be moved between properties.' : undefined}
          required
        >
          <Select
            value={form.watch('propertyId')}
            disabled={isEdit}
            onValueChange={(value) => {
              form.setValue('propertyId', value, { shouldDirty: true });
              // The old unit belongs to the old property; keeping it would send
              // a mismatched pair the API would reject.
              form.setValue('unitId', undefined);
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
          label="Unit"
          htmlFor="unitId"
          hint={isEdit ? undefined : 'Leave blank for work on the building itself.'}
        >
          <Select
            value={form.watch('unitId') ?? NO_UNIT}
            disabled={isEdit || !propertyId}
            onValueChange={(value) =>
              form.setValue('unitId', value === NO_UNIT ? undefined : value, { shouldDirty: true })
            }
          >
            <SelectTrigger id="unitId">
              <SelectValue placeholder={propertyId ? 'Whole property' : 'Choose a property first'} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_UNIT}>Whole property</SelectItem>
              {(units.data?.data ?? []).map((unit) => (
                <SelectItem key={unit.id} value={unit.id}>
                  {unit.unitNumber}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        <FormField label="Priority" htmlFor="priority" required>
          <Select
            value={form.watch('priority')}
            onValueChange={(value) =>
              form.setValue('priority', value as Values['priority'], { shouldDirty: true })
            }
          >
            <SelectTrigger id="priority">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PRIORITY_LABELS) as (keyof typeof PRIORITY_LABELS)[]).map((value) => (
                <SelectItem key={value} value={value}>
                  {PRIORITY_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        <FormField
          label="Estimated cost"
          htmlFor="estimatedCost"
          error={form.formState.errors.estimatedCost?.message}
          hint="What you expect it to cost."
        >
          <Input inputMode="decimal" placeholder="4500" {...form.register('estimatedCost')} />
        </FormField>
      </div>

      <FormField
        label="Title"
        htmlFor="title"
        error={form.formState.errors.title?.message}
        required
      >
        <Input placeholder="Kitchen tap will not close" {...form.register('title')} />
      </FormField>

      <FormField
        label="Description"
        htmlFor="description"
        error={form.formState.errors.description?.message}
        required
      >
        <Textarea
          rows={3}
          placeholder="Dripping constantly since Tuesday; the washer looks worn."
          {...form.register('description')}
        />
      </FormField>
    </FormDialog>
  );
}

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
import { FormDialog, applyFieldErrors } from '@/features/portfolio/components/form-dialog';
import { ApiError } from '@/lib/api-client';
import { ID_TYPE_LABELS } from '../labels';
import { useTenantMutations } from '../queries';
import { type TenantFormValues, tenantFormSchema } from '../schemas';
import type { Tenant } from '../types';

const FIELDS = [
  'fullName',
  'phone',
  'email',
  'nationalId',
  'idType',
  'occupation',
  'address',
  'emergencyContactName',
  'emergencyContactPhone',
];

function toPayload(values: TenantFormValues): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === '') continue;
    payload[key] = value;
  }
  return payload;
}

export function TenantFormDialog({
  open,
  onOpenChange,
  tenant,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenant?: Tenant;
}) {
  const isEdit = Boolean(tenant);
  const [formError, setFormError] = useState<string | null>(null);
  const { create, update } = useTenantMutations();

  const form = useForm<TenantFormValues>({
    resolver: zodResolver(tenantFormSchema),
    defaultValues: {
      fullName: '',
      phone: '',
      email: '',
      nationalId: '',
      occupation: '',
      address: '',
      emergencyContactName: '',
      emergencyContactPhone: '',
      notes: '',
    },
  });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    form.reset({
      fullName: tenant?.fullName ?? '',
      phone: tenant?.phone ?? '',
      email: tenant?.email ?? '',
      idType: tenant?.idType ?? undefined,
      nationalId: tenant?.nationalId ?? '',
      occupation: tenant?.occupation ?? '',
      address: tenant?.address ?? '',
      emergencyContactName: tenant?.emergencyContactName ?? '',
      emergencyContactPhone: tenant?.emergencyContactPhone ?? '',
      notes: tenant?.notes ?? '',
    });
  }, [open, tenant, form]);

  const submitting = create.isPending || update.isPending;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const body = toPayload(values);

    try {
      if (tenant) {
        await update.mutateAsync({ id: tenant.id, body });
        toast.success('Tenant updated.');
      } else {
        await create.mutateAsync(body);
        toast.success('Tenant added.');
      }
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError) {
        const attached = applyFieldErrors(error.fieldErrors, form.setError, FIELDS);
        if (!attached) setFormError(error.message);
        return;
      }
      setFormError('Could not save the tenant. Please try again.');
    }
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? 'Edit tenant' : 'Add a tenant'}
      description={
        isEdit
          ? 'Update this tenant’s details.'
          : 'Record someone who rents, or is about to rent, a unit. Assigning a unit comes next, through a lease.'
      }
      formError={formError}
      submitting={submitting}
      submitLabel={isEdit ? 'Save changes' : 'Add tenant'}
      onSubmit={onSubmit}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Full name"
          htmlFor="fullName"
          error={form.formState.errors.fullName?.message}
          className="sm:col-span-2"
          required
        >
          <Input placeholder="Grace Wanjiku" {...form.register('fullName')} />
        </FormField>

        <FormField label="Phone" htmlFor="phone" error={form.formState.errors.phone?.message} required>
          <Input inputMode="tel" placeholder="+254 711 000001" {...form.register('phone')} />
        </FormField>

        <FormField label="Email" htmlFor="email" error={form.formState.errors.email?.message}>
          <Input type="email" placeholder="grace@example.com" {...form.register('email')} />
        </FormField>

        <FormField label="ID type" htmlFor="idType">
          <Select
            value={form.watch('idType') ?? ''}
            onValueChange={(value) =>
              form.setValue('idType', value as TenantFormValues['idType'], { shouldDirty: true })
            }
          >
            <SelectTrigger id="idType">
              <SelectValue placeholder="Choose" />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ID_TYPE_LABELS) as (keyof typeof ID_TYPE_LABELS)[]).map((value) => (
                <SelectItem key={value} value={value}>
                  {ID_TYPE_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        <FormField
          label="ID number"
          htmlFor="nationalId"
          error={form.formState.errors.nationalId?.message}
          hint="Must be unique in your organization."
        >
          <Input {...form.register('nationalId')} />
        </FormField>

        <FormField label="Occupation" htmlFor="occupation">
          <Input placeholder="Teacher" {...form.register('occupation')} />
        </FormField>

        <FormField label="Address" htmlFor="address">
          <Input {...form.register('address')} />
        </FormField>

        <FormField label="Emergency contact" htmlFor="emergencyContactName">
          <Input placeholder="Next of kin" {...form.register('emergencyContactName')} />
        </FormField>

        <FormField
          label="Emergency phone"
          htmlFor="emergencyContactPhone"
          error={form.formState.errors.emergencyContactPhone?.message}
        >
          <Input inputMode="tel" {...form.register('emergencyContactPhone')} />
        </FormField>
      </div>

      <FormField label="Notes" htmlFor="notes">
        <Textarea rows={2} {...form.register('notes')} />
      </FormField>
    </FormDialog>
  );
}

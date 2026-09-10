'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { portfolioApi } from '@/features/portfolio/api';
import { ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-client';
import { formatMoney } from '@/lib/utils';
import { occupancyApi } from '../api';
import { useLeaseMutations } from '../queries';
import { type LeaseFormValues, leaseFormSchema } from '../schemas';

const FIELDS = [
  'tenantId',
  'unitId',
  'startDate',
  'endDate',
  'monthlyRent',
  'securityDeposit',
  'depositPaid',
  'dueDay',
];

function toPayload(values: LeaseFormValues): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === '') continue;
    // dueDay is the only genuinely numeric field. Money stays a string.
    payload[key] = key === 'dueDay' ? Number(value) : value;
  }
  return payload;
}

/**
 * Moving a tenant in.
 *
 * The unit picker offers only vacant units, because that is the only kind the
 * API will accept — showing occupied ones would just produce a 409 the user
 * could have been spared.
 */
export function LeaseFormDialog({
  open,
  onOpenChange,
  lockedTenantId,
  lockedUnitId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lockedTenantId?: string;
  lockedUnitId?: string;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const { create } = useLeaseMutations();

  // 100 is the API's maximum page size. Asking for more is a 400, which used to
  // leave the picker silently empty — hence the explicit error state below.
  const tenantQuery = { limit: 100, sortBy: 'fullName', sortOrder: 'asc' } as const;
  const tenants = useQuery({
    queryKey: queryKeys.tenants(tenantQuery),
    queryFn: () => occupancyApi.tenants.list(tenantQuery),
    enabled: open,
  });

  const vacantUnits = useQuery({
    queryKey: queryKeys.vacantUnits(),
    queryFn: () => portfolioApi.units.vacant(),
    enabled: open,
  });

  const form = useForm<LeaseFormValues>({
    resolver: zodResolver(leaseFormSchema),
    defaultValues: {
      tenantId: lockedTenantId ?? '',
      unitId: lockedUnitId ?? '',
      startDate: new Date().toISOString().slice(0, 10),
      endDate: '',
      monthlyRent: '',
      securityDeposit: '',
      depositPaid: '',
      dueDay: '5',
      notes: '',
    },
  });

  const selectedUnitId = form.watch('unitId');
  const selectedUnit = (vacantUnits.data ?? []).find((unit) => unit.id === selectedUnitId);

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    form.reset({
      tenantId: lockedTenantId ?? '',
      unitId: lockedUnitId ?? '',
      startDate: new Date().toISOString().slice(0, 10),
      endDate: '',
      monthlyRent: '',
      securityDeposit: '',
      depositPaid: '',
      dueDay: '5',
      notes: '',
    });
  }, [open, lockedTenantId, lockedUnitId, form]);

  // Choosing a unit fills in its rent and deposit as a starting point. They
  // remain editable: the lease records what was agreed, not what the unit
  // currently advertises.
  useEffect(() => {
    if (!selectedUnit) return;
    if (!form.getValues('monthlyRent')) {
      form.setValue('monthlyRent', selectedUnit.monthlyRent);
    }
    if (!form.getValues('securityDeposit')) {
      form.setValue('securityDeposit', selectedUnit.securityDeposit);
    }
  }, [selectedUnit, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await create.mutateAsync(toPayload(values));
      toast.success('Lease created. The unit is now occupied.');
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError) {
        const attached = applyFieldErrors(error.fieldErrors, form.setError, FIELDS);
        if (!attached) setFormError(error.message);
        return;
      }
      setFormError('Could not create the lease. Please try again.');
    }
  });

  const noVacantUnits = vacantUnits.isSuccess && (vacantUnits.data?.length ?? 0) === 0;
  const tenantsTruncated =
    (tenants.data?.meta.total ?? 0) > (tenants.data?.data.length ?? 0);
  const loadFailed = tenants.isError || vacantUnits.isError;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Create a lease"
      description="Moves a tenant into a vacant unit. The unit becomes occupied in the same step."
      formError={formError}
      submitting={create.isPending}
      submitLabel="Create lease"
      onSubmit={onSubmit}
    >
      {loadFailed ? (
        <Alert variant="destructive">
          <AlertDescription>
            {/* An empty dropdown is indistinguishable from "no records"; say
                which it is. */}
            Tenants or units could not be loaded, so the lists below may be
            incomplete. Close this dialog and try again.
          </AlertDescription>
        </Alert>
      ) : null}

      {noVacantUnits ? (
        <Alert variant="warning">
          <AlertDescription>
            There are no vacant units to lease. Add a unit, or end an existing lease first.
          </AlertDescription>
        </Alert>
      ) : null}

      <FormField
        label="Tenant"
        htmlFor="tenantId"
        error={form.formState.errors.tenantId?.message}
        hint={
          tenantsTruncated
            ? `Showing the first ${tenants.data?.data.length} of ${tenants.data?.meta.total} tenants, by name.`
            : undefined
        }
        required
      >
        <Select
          value={form.watch('tenantId')}
          disabled={Boolean(lockedTenantId)}
          onValueChange={(value) => form.setValue('tenantId', value, { shouldDirty: true })}
        >
          <SelectTrigger id="tenantId">
            <SelectValue placeholder="Choose a tenant" />
          </SelectTrigger>
          <SelectContent>
            {(tenants.data?.data ?? []).map((tenant) => (
              <SelectItem key={tenant.id} value={tenant.id}>
                {tenant.fullName} · {tenant.phone}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>

      <FormField
        label="Unit"
        htmlFor="unitId"
        error={form.formState.errors.unitId?.message}
        hint="Only vacant units can be leased."
        required
      >
        <Select
          value={form.watch('unitId')}
          disabled={Boolean(lockedUnitId)}
          onValueChange={(value) => form.setValue('unitId', value, { shouldDirty: true })}
        >
          <SelectTrigger id="unitId">
            <SelectValue placeholder="Choose a vacant unit" />
          </SelectTrigger>
          <SelectContent>
            {(vacantUnits.data ?? []).map((unit) => (
              <SelectItem key={unit.id} value={unit.id}>
                {unit.property.name} · {unit.unitNumber} · {formatMoney(unit.monthlyRent)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Start date"
          htmlFor="startDate"
          error={form.formState.errors.startDate?.message}
          required
        >
          <Input type="date" {...form.register('startDate')} />
        </FormField>

        <FormField
          label="End date"
          htmlFor="endDate"
          error={form.formState.errors.endDate?.message}
          hint="Leave empty for an open-ended lease."
        >
          <Input type="date" {...form.register('endDate')} />
        </FormField>

        <FormField
          label="Monthly rent"
          htmlFor="monthlyRent"
          error={form.formState.errors.monthlyRent?.message}
          hint="Copied onto the lease, so later unit changes do not affect it."
        >
          <Input inputMode="decimal" placeholder="32000" {...form.register('monthlyRent')} />
        </FormField>

        <FormField
          label="Rent due day"
          htmlFor="dueDay"
          error={form.formState.errors.dueDay?.message}
          hint="1–28, so every month has that date."
          required
        >
          <Input type="number" min={1} max={28} {...form.register('dueDay')} />
        </FormField>

        <FormField
          label="Security deposit"
          htmlFor="securityDeposit"
          error={form.formState.errors.securityDeposit?.message}
        >
          <Input inputMode="decimal" placeholder="32000" {...form.register('securityDeposit')} />
        </FormField>

        <FormField
          label="Deposit received"
          htmlFor="depositPaid"
          error={form.formState.errors.depositPaid?.message}
          hint="How much has actually been paid."
        >
          <Input inputMode="decimal" placeholder="0" {...form.register('depositPaid')} />
        </FormField>
      </div>

      <FormField label="Notes" htmlFor="notes">
        <Textarea rows={2} {...form.register('notes')} />
      </FormField>
    </FormDialog>
  );
}

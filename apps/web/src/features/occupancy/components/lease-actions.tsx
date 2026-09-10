'use client';

import { zodResolver } from '@hookform/resolvers/zod';
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
import { ApiError } from '@/lib/api-client';
import { formatDate } from '@/lib/utils';
import { useLeaseMutations } from '../queries';
import {
  type RenewLeaseValues,
  type TerminateLeaseValues,
  renewLeaseSchema,
  terminateLeaseSchema,
} from '../schemas';
import type { Lease } from '../types';

export function RenewLeaseDialog({
  open,
  onOpenChange,
  lease,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lease: Lease;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const { renew } = useLeaseMutations();

  const form = useForm<RenewLeaseValues>({
    resolver: zodResolver(renewLeaseSchema),
    defaultValues: { endDate: '', monthlyRent: '', notes: '' },
  });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    // Default to a year past the current end date — the usual renewal.
    const base = lease.endDate ? new Date(lease.endDate) : new Date();
    base.setUTCFullYear(base.getUTCFullYear() + 1);
    form.reset({
      endDate: base.toISOString().slice(0, 10),
      monthlyRent: '',
      notes: '',
    });
  }, [open, lease, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const body: Record<string, unknown> = { endDate: values.endDate };
    if (values.monthlyRent) body.monthlyRent = values.monthlyRent;
    if (values.notes) body.notes = values.notes;

    try {
      await renew.mutateAsync({ id: lease.id, body });
      toast.success('Lease renewed.');
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError) {
        const attached = applyFieldErrors(error.fieldErrors, form.setError, [
          'endDate',
          'monthlyRent',
        ]);
        if (!attached) setFormError(error.message);
        return;
      }
      setFormError('Could not renew the lease. Please try again.');
    }
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Renew lease"
      description={`Extends ${lease.tenant.fullName}'s lease on unit ${lease.unit.unitNumber}.`}
      formError={formError}
      submitting={renew.isPending}
      submitLabel="Renew lease"
      onSubmit={onSubmit}
    >
      {lease.status === 'EXPIRED' ? (
        <Alert variant="info">
          <AlertDescription>
            This lease ended on {formatDate(lease.endDate)}. Renewing it puts it back to active —
            the unit was never released.
          </AlertDescription>
        </Alert>
      ) : null}

      <FormField
        label="New end date"
        htmlFor="endDate"
        error={form.formState.errors.endDate?.message}
        hint={
          lease.endDate ? `Must be after ${formatDate(lease.endDate)}.` : 'Sets an end date.'
        }
        required
      >
        <Input type="date" {...form.register('endDate')} />
      </FormField>

      <FormField
        label="New monthly rent"
        htmlFor="monthlyRent"
        error={form.formState.errors.monthlyRent?.message}
        hint="Leave empty to keep the current rent."
      >
        <Input inputMode="decimal" placeholder={lease.monthlyRent} {...form.register('monthlyRent')} />
      </FormField>

      <FormField label="Notes" htmlFor="notes">
        <Textarea rows={2} {...form.register('notes')} />
      </FormField>
    </FormDialog>
  );
}

export function TerminateLeaseDialog({
  open,
  onOpenChange,
  lease,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lease: Lease;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const { terminate } = useLeaseMutations();

  const form = useForm<TerminateLeaseValues>({
    resolver: zodResolver(terminateLeaseSchema),
    defaultValues: { reason: '', unitStatus: 'VACANT' },
  });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    form.reset({ reason: '', unitStatus: 'VACANT' });
  }, [open, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await terminate.mutateAsync({
        id: lease.id,
        body: { unitStatus: values.unitStatus, ...(values.reason ? { reason: values.reason } : {}) },
      });
      toast.success(`Lease ended. Unit ${lease.unit.unitNumber} is now ${values.unitStatus.toLowerCase()}.`);
      onOpenChange(false);
    } catch (error) {
      setFormError(
        error instanceof ApiError ? error.message : 'Could not end the lease. Please try again.',
      );
    }
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="End this lease"
      description={`${lease.tenant.fullName} moves out of unit ${lease.unit.unitNumber}.`}
      formError={formError}
      submitting={terminate.isPending}
      submitLabel="End lease"
      onSubmit={onSubmit}
    >
      <Alert variant="info">
        <AlertDescription>
          The lease is kept as the record of who lived here and on what terms — it is never
          deleted. The unit is released in the same step.
        </AlertDescription>
      </Alert>

      <FormField
        label="Unit becomes"
        htmlFor="unitStatus"
        hint="Choose maintenance if the unit needs work before it can be let again."
        required
      >
        <Select
          value={form.watch('unitStatus')}
          onValueChange={(value) =>
            form.setValue('unitStatus', value as TerminateLeaseValues['unitStatus'], {
              shouldDirty: true,
            })
          }
        >
          <SelectTrigger id="unitStatus">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="VACANT">Vacant — ready to let</SelectItem>
            <SelectItem value="MAINTENANCE">Maintenance — needs work first</SelectItem>
          </SelectContent>
        </Select>
      </FormField>

      <FormField label="Reason" htmlFor="reason" error={form.formState.errors.reason?.message}>
        <Textarea rows={2} placeholder="Tenant relocating" {...form.register('reason')} />
      </FormField>
    </FormDialog>
  );
}

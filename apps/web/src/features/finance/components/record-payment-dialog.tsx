'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
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
import { useSession } from '@/features/auth/use-session';
import { ApiError } from '@/lib/api-client';
import { formatMoney } from '@/lib/utils';
import { POSITIVE_MONEY } from '../money';
import { PAYMENT_METHOD_LABELS } from '../labels';
import { usePaymentMutations } from '../queries';
import type { RentRecord } from '../types';

const schema = z.object({
  amount: z
    .string()
    .trim()
    .min(1, 'Enter an amount')
    .regex(POSITIVE_MONEY, 'Enter an amount above zero, such as 20000 or 20000.00'),
  paymentDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date'),
  paymentMethod: z.enum(['MPESA', 'BANK', 'CASH', 'CHEQUE', 'OTHER']),
  reference: z.string().trim().max(80).optional().or(z.literal('')),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
});

type Values = z.infer<typeof schema>;

/**
 * The payment workflow from the master spec: pick the charge, enter the amount
 * and method, add the reference, confirm. Four fields, one button.
 */
export function RecordPaymentDialog({
  open,
  onOpenChange,
  rentRecord,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rentRecord: RentRecord;
}) {
  const { me } = useSession();
  const currency = me?.organization.currency ?? 'KES';
  const [formError, setFormError] = useState<string | null>(null);
  const { create } = usePaymentMutations();

  /*
   * One key per open dialog, not per submit.
   *
   * If the connection drops after the server committed but before the response
   * arrived, the user presses the button again — and this key makes the second
   * request replay the first instead of taking the money twice.
   */
  const idempotencyKey = useMemo(
    () => `pay-${rentRecord.id}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rentRecord.id, open],
  );

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      amount: '',
      paymentDate: new Date().toISOString().slice(0, 10),
      paymentMethod: 'MPESA',
      reference: '',
      notes: '',
    },
  });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    form.reset({
      // Defaults to settling the charge in full, which is the common case.
      amount: rentRecord.balance,
      paymentDate: new Date().toISOString().slice(0, 10),
      paymentMethod: 'MPESA',
      reference: '',
      notes: '',
    });
  }, [open, rentRecord, form]);

  const method = form.watch('paymentMethod');

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const body: Record<string, unknown> = {
      rentRecordId: rentRecord.id,
      amount: values.amount,
      paymentDate: values.paymentDate,
      paymentMethod: values.paymentMethod,
    };
    if (values.reference) body.reference = values.reference;
    if (values.notes) body.notes = values.notes;

    try {
      const result = await create.mutateAsync({ body, key: idempotencyKey });
      toast.success(`Payment recorded. Receipt ${result.receipt.receiptNumber}.`);
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError) {
        const attached = applyFieldErrors(error.fieldErrors, form.setError, [
          'amount',
          'reference',
          'paymentDate',
        ]);
        if (!attached) setFormError(error.message);
        return;
      }
      setFormError('Could not record the payment. Please try again.');
    }
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Record a payment"
      description={`${rentRecord.tenant.fullName} · unit ${rentRecord.unit.unitNumber} · ${rentRecord.periodLabel}`}
      formError={formError}
      submitting={create.isPending}
      submitLabel="Record payment"
      onSubmit={onSubmit}
    >
      <div className="rounded-md border bg-muted/40 p-3 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Charged</span>
          <span className="tabular-nums">{formatMoney(rentRecord.expectedAmount, currency)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Already paid</span>
          <span className="tabular-nums">{formatMoney(rentRecord.paidAmount, currency)}</span>
        </div>
        <div className="mt-1 flex justify-between border-t pt-1 font-medium">
          <span>Still owing</span>
          <span className="tabular-nums">{formatMoney(rentRecord.balance, currency)}</span>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Amount"
          htmlFor="amount"
          error={form.formState.errors.amount?.message}
          hint="Cannot exceed what is still owing."
          required
        >
          <Input inputMode="decimal" {...form.register('amount')} />
        </FormField>

        <FormField
          label="Payment date"
          htmlFor="paymentDate"
          error={form.formState.errors.paymentDate?.message}
          required
        >
          <Input type="date" max={new Date().toISOString().slice(0, 10)} {...form.register('paymentDate')} />
        </FormField>

        <FormField label="Method" htmlFor="paymentMethod" required>
          <Select
            value={method}
            onValueChange={(value) =>
              form.setValue('paymentMethod', value as Values['paymentMethod'], { shouldDirty: true })
            }
          >
            <SelectTrigger id="paymentMethod">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PAYMENT_METHOD_LABELS) as (keyof typeof PAYMENT_METHOD_LABELS)[]).map(
                (value) => (
                  <SelectItem key={value} value={value}>
                    {PAYMENT_METHOD_LABELS[value]}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </FormField>

        <FormField
          label="Reference"
          htmlFor="reference"
          error={form.formState.errors.reference?.message}
          hint={
            method === 'MPESA'
              ? 'Enter the M-Pesa code by hand — there is no gateway integration in this version.'
              : 'Slip or cheque number. Cannot be reused.'
          }
        >
          <Input placeholder={method === 'MPESA' ? 'SJK4H7X9QP' : ''} {...form.register('reference')} />
        </FormField>
      </div>

      {method === 'MPESA' ? (
        <Alert variant="info">
          <AlertDescription>
            M-Pesa payments are entered manually. Nothing is fetched from Safaricom — automatic
            reconciliation is a later version.
          </AlertDescription>
        </Alert>
      ) : null}

      <FormField label="Notes" htmlFor="notes">
        <Textarea rows={2} {...form.register('notes')} />
      </FormField>
    </FormDialog>
  );
}

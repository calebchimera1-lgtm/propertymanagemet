'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FormField } from '@/components/ui/form-field';
import { Textarea } from '@/components/ui/textarea';
import { FormDialog, applyFieldErrors } from '@/features/portfolio/components/form-dialog';
import { useSession } from '@/features/auth/use-session';
import { ApiError } from '@/lib/api-client';
import { formatMoney } from '@/lib/utils';
import { PAYMENT_METHOD_LABELS } from '../labels';
import { usePaymentMutations } from '../queries';
import type { Payment } from '../types';

const schema = z.object({
  reason: z.string().trim().min(3, 'Say why this payment is being reversed').max(500),
});

type Values = z.infer<typeof schema>;

/**
 * Payments are never edited or deleted — a recorded payment is a historical
 * fact. A mistake is corrected by voiding it, which reverses the amount off the
 * charge and marks the receipt void while keeping its number in the sequence.
 */
export function VoidPaymentDialog({
  open,
  onOpenChange,
  payment,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: Payment;
}) {
  const { me } = useSession();
  const currency = me?.organization.currency ?? 'KES';
  const [formError, setFormError] = useState<string | null>(null);
  const { void: voidPayment } = usePaymentMutations();

  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { reason: '' } });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    form.reset({ reason: '' });
  }, [open, payment, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await voidPayment.mutateAsync({ id: payment.id, body: { reason: values.reason } });
      toast.success('Payment voided. The balance has been put back on the charge.');
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError) {
        const attached = applyFieldErrors(error.fieldErrors, form.setError, ['reason']);
        if (!attached) setFormError(error.message);
        return;
      }
      setFormError('Could not void the payment. Please try again.');
    }
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Void this payment"
      description={`${payment.tenant.fullName} · ${formatMoney(payment.amount, currency)} · ${PAYMENT_METHOD_LABELS[payment.paymentMethod]}`}
      formError={formError}
      submitting={voidPayment.isPending}
      submitLabel="Void payment"
      destructive
      onSubmit={onSubmit}
    >
      <Alert variant="warning">
        <AlertDescription>
          The payment stays on record as voided — nothing is deleted. {formatMoney(payment.amount, currency)}{' '}
          goes back onto the {payment.periodLabel ?? 'rent'} charge, and receipt{' '}
          {payment.receipt?.receiptNumber ?? '—'} is marked void but keeps its number so the receipt
          sequence stays gapless.
        </AlertDescription>
      </Alert>

      <FormField
        label="Reason"
        htmlFor="reason"
        error={form.formState.errors.reason?.message}
        hint="Stored on the payment and in the audit log."
        required
      >
        <Textarea rows={3} placeholder="Bank reversed the transfer" {...form.register('reason')} />
      </FormField>
    </FormDialog>
  );
}

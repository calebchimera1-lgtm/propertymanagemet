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
import { useProperties } from '@/features/portfolio/queries';
import { ApiError } from '@/lib/api-client';
import { POSITIVE_MONEY } from '../money';
import { EXPENSE_CATEGORY_LABELS, PAYMENT_METHOD_LABELS } from '../labels';
import { useExpenseMutations } from '../queries';
import type { Expense } from '../types';

const schema = z.object({
  propertyId: z.string().min(1, 'Choose a property'),
  category: z.enum([
    'MAINTENANCE', 'REPAIRS', 'SECURITY', 'CLEANING', 'WATER', 'ELECTRICITY',
    'GARBAGE', 'SALARIES', 'INSURANCE', 'TAXES', 'MANAGEMENT', 'CONSTRUCTION', 'OTHER',
  ]),
  description: z.string().trim().min(2, 'Describe what this was for').max(500),
  amount: z
    .string()
    .trim()
    .min(1, 'Enter an amount')
    .regex(POSITIVE_MONEY, 'Enter an amount above zero, such as 12500 or 12500.00'),
  expenseDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date'),
  paymentMethod: z.enum(['MPESA', 'BANK', 'CASH', 'CHEQUE', 'OTHER']).optional(),
  vendor: z.string().trim().max(120).optional().or(z.literal('')),
  reference: z.string().trim().max(80).optional().or(z.literal('')),
});

type Values = z.infer<typeof schema>;
const FIELDS = ['propertyId', 'category', 'description', 'amount', 'expenseDate'];

export function ExpenseFormDialog({
  open,
  onOpenChange,
  expense,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expense?: Expense;
}) {
  const isEdit = Boolean(expense);
  const [formError, setFormError] = useState<string | null>(null);
  const { create, update } = useExpenseMutations();
  const properties = useProperties({ limit: 100, sortBy: 'name', sortOrder: 'asc' });

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      propertyId: '',
      category: 'MAINTENANCE',
      description: '',
      amount: '',
      expenseDate: new Date().toISOString().slice(0, 10),
      vendor: '',
      reference: '',
    },
  });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    form.reset({
      propertyId: expense?.propertyId ?? '',
      category: expense?.category ?? 'MAINTENANCE',
      description: expense?.description ?? '',
      amount: expense?.amount ?? '',
      expenseDate: expense?.expenseDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
      paymentMethod: expense?.paymentMethod ?? undefined,
      vendor: expense?.vendor ?? '',
      reference: expense?.reference ?? '',
    });
  }, [open, expense, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const body: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined || value === '') continue;
      body[key] = value;
    }

    try {
      if (expense) {
        // The property is fixed for the life of an expense.
        const { propertyId: _omit, ...rest } = body;
        await update.mutateAsync({ id: expense.id, body: rest });
        toast.success('Expense updated.');
      } else {
        await create.mutateAsync(body);
        toast.success('Expense recorded.');
      }
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError) {
        const attached = applyFieldErrors(error.fieldErrors, form.setError, FIELDS);
        if (!attached) setFormError(error.message);
        return;
      }
      setFormError('Could not save the expense. Please try again.');
    }
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? 'Edit expense' : 'Record an expense'}
      description={
        isEdit
          ? 'Update this expense. Its property cannot be changed.'
          : 'Money spent on a property. Feeds the profit and loss report.'
      }
      formError={formError}
      submitting={create.isPending || update.isPending}
      submitLabel={isEdit ? 'Save changes' : 'Record expense'}
      onSubmit={onSubmit}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Property"
          htmlFor="propertyId"
          error={form.formState.errors.propertyId?.message}
          hint={isEdit ? 'An expense cannot be moved between properties.' : undefined}
          required
        >
          <Select
            value={form.watch('propertyId')}
            disabled={isEdit}
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

        <FormField label="Category" htmlFor="category" required>
          <Select
            value={form.watch('category')}
            onValueChange={(value) =>
              form.setValue('category', value as Values['category'], { shouldDirty: true })
            }
          >
            <SelectTrigger id="category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(
                Object.keys(EXPENSE_CATEGORY_LABELS) as (keyof typeof EXPENSE_CATEGORY_LABELS)[]
              ).map((value) => (
                <SelectItem key={value} value={value}>
                  {EXPENSE_CATEGORY_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        <FormField
          label="Amount"
          htmlFor="amount"
          error={form.formState.errors.amount?.message}
          required
        >
          <Input inputMode="decimal" placeholder="12500" {...form.register('amount')} />
        </FormField>

        <FormField
          label="Date"
          htmlFor="expenseDate"
          error={form.formState.errors.expenseDate?.message}
          required
        >
          <Input
            type="date"
            max={new Date().toISOString().slice(0, 10)}
            {...form.register('expenseDate')}
          />
        </FormField>

        <FormField label="Paid by" htmlFor="paymentMethod">
          <Select
            value={form.watch('paymentMethod') ?? ''}
            onValueChange={(value) =>
              form.setValue('paymentMethod', value as Values['paymentMethod'], { shouldDirty: true })
            }
          >
            <SelectTrigger id="paymentMethod">
              <SelectValue placeholder="Choose" />
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

        <FormField label="Vendor" htmlFor="vendor">
          <Input placeholder="Nairobi Pumps Ltd" {...form.register('vendor')} />
        </FormField>
      </div>

      <FormField
        label="Description"
        htmlFor="description"
        error={form.formState.errors.description?.message}
        required
      >
        <Textarea rows={2} placeholder="Replaced the water pump" {...form.register('description')} />
      </FormField>

      <FormField label="Reference" htmlFor="reference">
        <Input placeholder="Invoice or receipt number" {...form.register('reference')} />
      </FormField>
    </FormDialog>
  );
}

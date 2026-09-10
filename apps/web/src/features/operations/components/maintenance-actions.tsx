'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
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
import { ApiError } from '@/lib/api-client';
import { ALLOWED_TRANSITIONS, MAINTENANCE_STATUS_LABELS } from '../labels';
import { useMaintenanceMutations, useStaffList } from '../queries';
import type * as React from 'react';
import type { MaintenanceDetail, MaintenanceStatus } from '../types';

const UNASSIGNED = '__unassigned__';
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;

/** Assigns or clears the owner of a job. */
export function AssignMaintenanceDialog({
  open,
  onOpenChange,
  request,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: MaintenanceDetail;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const [assignedToId, setAssignedToId] = useState<string>(UNASSIGNED);
  const [note, setNote] = useState('');
  const { assign } = useMaintenanceMutations();

  // Only active staff: assigning to a deactivated account leaves a job nobody
  // can see, which reads as assigned but behaves as abandoned.
  const staff = useStaffList({ status: 'ACTIVE', limit: 100, sortBy: 'fullName', sortOrder: 'asc' });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    setAssignedToId(request.assignedToId ?? UNASSIGNED);
    setNote('');
  }, [open, request]);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    try {
      await assign.mutateAsync({
        id: request.id,
        body: {
          assignedToId: assignedToId === UNASSIGNED ? null : assignedToId,
          ...(note ? { note } : {}),
        },
      });
      toast.success(assignedToId === UNASSIGNED ? 'Assignment cleared.' : 'Request assigned.');
      onOpenChange(false);
    } catch (error) {
      setFormError(
        error instanceof ApiError ? error.message : 'Could not assign the request. Please try again.',
      );
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Assign this request"
      description={request.title}
      formError={formError}
      submitting={assign.isPending}
      submitLabel="Save assignment"
      onSubmit={onSubmit}
    >
      <FormField
        label="Assign to"
        htmlFor="assignedToId"
        hint="Clearing the assignment moves an assigned request back to pending."
      >
        <Select value={assignedToId} onValueChange={setAssignedToId}>
          <SelectTrigger id="assignedToId">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNASSIGNED}>Nobody yet</SelectItem>
            {(staff.data?.data ?? []).map((member) => (
              <SelectItem key={member.id} value={member.id}>
                {member.fullName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>

      {staff.isError ? (
        <Alert variant="warning">
          <AlertDescription>
            The staff list could not be loaded, so this shows nobody to assign to. That is a failed
            request, not an empty organization.
          </AlertDescription>
        </Alert>
      ) : null}

      <FormField label="Note" htmlFor="assign-note" hint="Added to the timeline.">
        <Textarea
          id="assign-note"
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Plumber booked for Thursday morning."
        />
      </FormField>
    </FormDialog>
  );
}

const statusSchema = z.object({
  note: z.string().trim().max(2000).optional().or(z.literal('')),
  actualCost: z
    .string()
    .trim()
    .regex(MONEY, 'Enter an amount such as 5200 or 5200.00')
    .optional()
    .or(z.literal('')),
});

type StatusValues = z.infer<typeof statusSchema>;

/**
 * Moves a request to one specific status.
 *
 * The caller picks the target from ALLOWED_TRANSITIONS, so this dialog never
 * offers a move the server would refuse.
 */
export function ChangeStatusDialog({
  open,
  onOpenChange,
  request,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: MaintenanceDetail;
  target: MaintenanceStatus;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const { changeStatus } = useMaintenanceMutations();
  const isCompleting = target === 'COMPLETED';
  const isCancelling = target === 'CANCELLED';

  const form = useForm<StatusValues>({
    resolver: zodResolver(statusSchema),
    defaultValues: { note: '', actualCost: '' },
  });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    form.reset({ note: '', actualCost: request.actualCost ?? request.estimatedCost ?? '' });
  }, [open, request, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await changeStatus.mutateAsync({
        id: request.id,
        body: {
          status: target,
          ...(values.note ? { note: values.note } : {}),
          ...(isCompleting && values.actualCost ? { actualCost: values.actualCost } : {}),
        },
      });
      toast.success(`Marked ${MAINTENANCE_STATUS_LABELS[target].toLowerCase()}.`);
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError) {
        const attached = applyFieldErrors(error.fieldErrors, form.setError, ['note', 'actualCost']);
        if (!attached) setFormError(error.message);
        return;
      }
      setFormError('Could not change the status. Please try again.');
    }
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Mark ${MAINTENANCE_STATUS_LABELS[target].toLowerCase()}`}
      description={request.title}
      formError={formError}
      submitting={changeStatus.isPending}
      submitLabel={`Mark ${MAINTENANCE_STATUS_LABELS[target].toLowerCase()}`}
      destructive={isCancelling}
      onSubmit={onSubmit}
    >
      {isCompleting || isCancelling ? (
        <Alert variant={isCancelling ? 'warning' : 'info'}>
          <AlertDescription>
            {isCompleting
              ? 'Completed requests are final. If the same fault comes back, raise a new request — that way each job keeps its own cost and timeline.'
              : 'Cancelled requests are final and cannot be reopened.'}
          </AlertDescription>
        </Alert>
      ) : null}

      {isCompleting ? (
        <FormField
          label="Actual cost"
          htmlFor="actualCost"
          error={form.formState.errors.actualCost?.message}
          hint="Recorded on the request. This does not create an expense — record that separately so it is not counted twice."
        >
          <Input inputMode="decimal" placeholder="5200" {...form.register('actualCost')} />
        </FormField>
      ) : null}

      <FormField label="Note" htmlFor="status-note" hint="Added to the timeline.">
        <Textarea rows={2} {...form.register('note')} />
      </FormField>
    </FormDialog>
  );
}

/** Adds a plain note to the timeline without moving the status. */
export function AddNoteDialog({
  open,
  onOpenChange,
  request,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: MaintenanceDetail;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const { addUpdate } = useMaintenanceMutations();

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    setNote('');
  }, [open]);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (note.trim().length < 2) {
      setFormError('Write something before adding it to the timeline.');
      return;
    }
    setFormError(null);
    try {
      await addUpdate.mutateAsync({ id: request.id, body: { note: note.trim() } });
      toast.success('Note added.');
      onOpenChange(false);
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Could not add the note.');
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add a note"
      description={request.title}
      formError={formError}
      submitting={addUpdate.isPending}
      submitLabel="Add note"
      onSubmit={onSubmit}
    >
      <FormField label="Note" htmlFor="timeline-note" required>
        <Textarea
          id="timeline-note"
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Parts ordered; expected Friday."
        />
      </FormField>
    </FormDialog>
  );
}

export { ALLOWED_TRANSITIONS };

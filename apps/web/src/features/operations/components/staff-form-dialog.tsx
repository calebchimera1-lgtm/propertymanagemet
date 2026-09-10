'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FormDialog, applyFieldErrors } from '@/features/portfolio/components/form-dialog';
import { ApiError } from '@/lib/api-client';
import { ASSIGNABLE_ROLES, ROLE_LABELS, isScopedRole } from '../labels';
import { useStaffMutations } from '../queries';
import type { StaffMember } from '../types';

const schema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  fullName: z.string().trim().min(2, 'Enter their full name').max(120),
  role: z.enum(ASSIGNABLE_ROLES),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
});

type Values = z.infer<typeof schema>;
const FIELDS = ['email', 'fullName', 'role', 'phone'];

/**
 * Shown once, after an invite is created.
 *
 * Email is not delivered in this version, so the link has to reach the person
 * somehow. Saying that plainly — and admitting it cannot be shown again — is
 * better than a "we've sent them an email" message that is not true.
 */
function InviteLinkDialog({
  url,
  expiresInDays,
  onClose,
}: {
  url: string;
  expiresInDays: number;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send them this link</DialogTitle>
          <DialogDescription>
            Email delivery is not enabled in this version, so nothing has been sent. Copy this link
            and pass it on yourself.
          </DialogDescription>
        </DialogHeader>

        <Alert variant="warning">
          <AlertDescription>
            This is the only time the link is shown. It cannot be retrieved later, expires in{' '}
            {expiresInDays} days, and can be used once. Treat it like a password.
          </AlertDescription>
        </Alert>

        <div className="flex gap-2">
          <Input readOnly value={url} aria-label="Invite link" className="font-mono text-xs" />
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                toast.success('Link copied.');
              } catch {
                // Clipboard access can be refused; the link is on screen either way.
                toast.error('Could not copy. Select the link and copy it by hand.');
              }
            }}
          >
            <Copy className="h-4 w-4" aria-hidden />
            Copy
          </Button>
        </div>

        <DialogFooter>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function StaffFormDialog({
  open,
  onOpenChange,
  staff,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staff?: StaffMember;
}) {
  const isEdit = Boolean(staff);
  const [formError, setFormError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ url: string; expiresInDays: number } | null>(null);
  const { create, update } = useStaffMutations();

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', fullName: '', role: 'CARETAKER', phone: '' },
  });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    form.reset({
      email: staff?.email ?? '',
      fullName: staff?.fullName ?? '',
      role: (staff?.roles[0] as Values['role']) ?? 'CARETAKER',
      phone: staff?.phone ?? '',
    });
  }, [open, staff, form]);

  const role = form.watch('role');

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (staff) {
        await update.mutateAsync({
          id: staff.id,
          body: {
            fullName: values.fullName,
            ...(values.phone ? { phone: values.phone } : {}),
            ...(values.role !== staff.roles[0] ? { role: values.role } : {}),
          },
        });
        toast.success('Staff member updated.');
        onOpenChange(false);
      } else {
        const result = await create.mutateAsync({
          email: values.email,
          fullName: values.fullName,
          role: values.role,
          ...(values.phone ? { phone: values.phone } : {}),
        });
        onOpenChange(false);
        // Hand the link over before anything else happens on screen.
        setInvite({ url: result.invite.url, expiresInDays: result.invite.expiresInDays });
      }
    } catch (error) {
      if (error instanceof ApiError) {
        const attached = applyFieldErrors(error.fieldErrors, form.setError, FIELDS);
        if (!attached) setFormError(error.message);
        return;
      }
      setFormError('Could not save. Please try again.');
    }
  });

  return (
    <>
      <FormDialog
        open={open}
        onOpenChange={onOpenChange}
        title={isEdit ? 'Edit staff member' : 'Invite a staff member'}
        description={
          isEdit
            ? 'Their email address cannot be changed. You cannot change your own role.'
            : 'Creates their account and gives you a one-time link to send them.'
        }
        formError={formError}
        submitting={create.isPending || update.isPending}
        submitLabel={isEdit ? 'Save changes' : 'Create invite'}
        onSubmit={onSubmit}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="Full name"
            htmlFor="fullName"
            error={form.formState.errors.fullName?.message}
            required
          >
            <Input placeholder="Peter Kamau" {...form.register('fullName')} />
          </FormField>

          <FormField
            label="Email"
            htmlFor="email"
            error={form.formState.errors.email?.message}
            hint={isEdit ? 'An account keeps the address it was created with.' : undefined}
            required
          >
            <Input
              type="email"
              disabled={isEdit}
              placeholder="peter@example.com"
              {...form.register('email')}
            />
          </FormField>

          <FormField label="Role" htmlFor="role" required>
            <Select
              value={role}
              onValueChange={(value) =>
                form.setValue('role', value as Values['role'], { shouldDirty: true })
              }
            >
              <SelectTrigger id="role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASSIGNABLE_ROLES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {ROLE_LABELS[value] ?? value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="Phone" htmlFor="phone">
            <Input placeholder="+254711000123" {...form.register('phone')} />
          </FormField>
        </div>

        <Alert variant="info">
          <AlertDescription>
            {isScopedRole(role)
              ? `${ROLE_LABELS[role]}s see only the properties you assign them. Until you assign one, they see nothing.`
              : `${ROLE_LABELS[role]}s can see every property in the organization.`}
          </AlertDescription>
        </Alert>
      </FormDialog>

      {invite ? (
        <InviteLinkDialog
          url={invite.url}
          expiresInDays={invite.expiresInDays}
          onClose={() => setInvite(null)}
        />
      ) : null}
    </>
  );
}

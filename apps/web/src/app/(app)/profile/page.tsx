'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Monitor } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { SessionSummary } from '@pm/types';
import { PageHeader } from '@/components/layout/page-header';
import { TableSkeleton } from '@/components/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { authApi } from '@/features/auth/api';
import {
  type ChangePasswordInput,
  type UpdateProfileInput,
  changePasswordSchema,
  updateProfileSchema,
} from '@/features/auth/schemas';
import { useSession } from '@/features/auth/use-session';
import { ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-client';
import { formatDateTime } from '@/lib/utils';

export default function ProfilePage() {
  const { me } = useSession();
  const queryClient = useQueryClient();
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const profileForm = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    values: { fullName: me?.user.fullName ?? '', phone: me?.user.phone ?? '' },
  });

  const passwordForm = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const updateProfile = useMutation({
    mutationFn: (values: UpdateProfileInput) => authApi.updateProfile(values),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.me, updated);
      toast.success('Profile updated.');
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not update your profile.'),
  });

  const changePassword = useMutation({
    mutationFn: (values: ChangePasswordInput) =>
      authApi.changePassword(values.currentPassword, values.newPassword),
    onSuccess: (result) => {
      toast.success(result.message);
      passwordForm.reset();
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        const fieldErrors = error.fieldErrors;
        if (fieldErrors.currentPassword) {
          passwordForm.setError('currentPassword', { message: fieldErrors.currentPassword });
          return;
        }
        setPasswordError(error.message);
        return;
      }
      setPasswordError('Could not change your password.');
    },
  });

  const sessions = useQuery({ queryKey: queryKeys.sessions, queryFn: authApi.sessions });

  const revokeSession = useMutation({
    mutationFn: (id: string) => authApi.revokeSession(id),
    onSuccess: () => {
      toast.success('That device has been signed out.');
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    },
    onError: () => toast.error('Could not sign that device out.'),
  });

  return (
    <>
      <PageHeader title="Your profile" description="Your details, password and signed-in devices." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
            <CardDescription>
              Your email address is {me?.user.email}. Changing it is not available in Version 1.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              noValidate
              onSubmit={profileForm.handleSubmit((values) => updateProfile.mutate(values))}
            >
              <FormField
                label="Full name"
                htmlFor="fullName"
                error={profileForm.formState.errors.fullName?.message}
                required
              >
                <Input autoComplete="name" {...profileForm.register('fullName')} />
              </FormField>

              <FormField
                label="Phone"
                htmlFor="phone"
                error={profileForm.formState.errors.phone?.message}
                hint="Optional. Used for internal contact only."
              >
                <Input autoComplete="tel" placeholder="+254 700 000000" {...profileForm.register('phone')} />
              </FormField>

              <Button type="submit" loading={updateProfile.isPending}>
                Save changes
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
            <CardDescription>
              Every other signed-in device will be signed out. This one stays signed in.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              noValidate
              onSubmit={passwordForm.handleSubmit((values) => {
                setPasswordError(null);
                changePassword.mutate(values);
              })}
            >
              {passwordError ? (
                <Alert variant="destructive">
                  <AlertDescription>{passwordError}</AlertDescription>
                </Alert>
              ) : null}

              <FormField
                label="Current password"
                htmlFor="currentPassword"
                error={passwordForm.formState.errors.currentPassword?.message}
                required
              >
                <Input
                  type="password"
                  autoComplete="current-password"
                  {...passwordForm.register('currentPassword')}
                />
              </FormField>

              <FormField
                label="New password"
                htmlFor="newPassword"
                error={passwordForm.formState.errors.newPassword?.message}
                hint="At least 12 characters, with upper case, lower case and a number."
                required
              >
                <Input
                  type="password"
                  autoComplete="new-password"
                  {...passwordForm.register('newPassword')}
                />
              </FormField>

              <FormField
                label="Confirm new password"
                htmlFor="confirmPassword"
                error={passwordForm.formState.errors.confirmPassword?.message}
                required
              >
                <Input
                  type="password"
                  autoComplete="new-password"
                  {...passwordForm.register('confirmPassword')}
                />
              </FormField>

              <Button type="submit" loading={changePassword.isPending}>
                Change password
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Signed-in devices</CardTitle>
          <CardDescription>
            Every browser currently holding a session. Revoke any you do not recognise.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sessions.isLoading ? (
            <TableSkeleton rows={2} columns={3} />
          ) : (
            <ul className="space-y-3">
              {(sessions.data ?? []).map((session: SessionSummary) => (
                <li
                  key={session.id}
                  className="flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 gap-3">
                    <Monitor className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {session.userAgent ?? 'Unknown device'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {session.ipAddress ?? 'Unknown address'} · last active{' '}
                        {formatDateTime(session.lastSeenAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {session.current ? (
                      <Badge variant="success">This device</Badge>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={revokeSession.isPending}
                        onClick={() => revokeSession.mutate(session.id)}
                      >
                        Sign out
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}

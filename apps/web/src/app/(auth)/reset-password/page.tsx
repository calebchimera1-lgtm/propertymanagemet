'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { authApi } from '@/features/auth/api';
import { type ResetPasswordInput, resetPasswordSchema } from '@/features/auth/schemas';
import { ApiError } from '@/lib/api-client';

function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token, password: '', confirmPassword: '' },
  });

  const reset = useMutation({
    mutationFn: (values: ResetPasswordInput) => authApi.resetPassword(values.token, values.password),
    onSuccess: () => {
      toast.success('Password changed. Please sign in.');
      router.replace('/login');
    },
    onError: (error) =>
      setFormError(
        error instanceof ApiError ? error.message : 'Could not reset your password. Try again.',
      ),
  });

  if (!token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>This link is not valid</CardTitle>
          <CardDescription>
            The reset link is missing its token. Request a new one and use the most recent email.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/forgot-password">Request a new link</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose a new password</CardTitle>
        <CardDescription>
          For your security, every device signed in to this account will be signed out.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          noValidate
          onSubmit={handleSubmit((values) => {
            setFormError(null);
            reset.mutate(values);
          })}
        >
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}

          <input type="hidden" {...register('token')} />

          <FormField
            label="New password"
            htmlFor="password"
            error={errors.password?.message}
            hint="At least 12 characters, with upper case, lower case and a number."
            required
          >
            <Input type="password" autoComplete="new-password" {...register('password')} />
          </FormField>

          <FormField
            label="Confirm new password"
            htmlFor="confirmPassword"
            error={errors.confirmPassword?.message}
            required
          >
            <Input type="password" autoComplete="new-password" {...register('confirmPassword')} />
          </FormField>

          <Button type="submit" className="w-full" loading={reset.isPending}>
            Change password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}

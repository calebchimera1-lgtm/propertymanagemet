'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { authApi } from '@/features/auth/api';
import { type ForgotPasswordInput, forgotPasswordSchema } from '@/features/auth/schemas';

export default function ForgotPasswordPage() {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const requestReset = useMutation({
    mutationFn: (values: ForgotPasswordInput) => authApi.forgotPassword(values.email),
  });

  // The same confirmation appears whether or not the address is registered:
  // saying "no such account" here would turn this page into an account finder.
  if (requestReset.isSuccess) {
    return (
      <Card>
        <CardHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-success/10">
            <MailCheck className="h-5 w-5 text-success" aria-hidden />
          </div>
          <CardTitle>Check your email</CardTitle>
          <CardDescription>
            If that address has an account, a reset link is on its way. It expires in one hour.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="info" className="mb-4">
            <AlertDescription>
              Email delivery is not switched on in this version. Your administrator can find the
              reset link in the API server log.
            </AlertDescription>
          </Alert>
          <Button asChild variant="outline" className="w-full">
            <Link href="/login">Back to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reset your password</CardTitle>
        <CardDescription>
          Enter the email address on your account and we will send you a reset link.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          noValidate
          onSubmit={handleSubmit((values) => requestReset.mutate(values))}
        >
          <FormField label="Email" htmlFor="email" error={errors.email?.message} required>
            <Input type="email" autoComplete="email" placeholder="you@company.com" {...register('email')} />
          </FormField>

          <Button type="submit" className="w-full" loading={requestReset.isPending}>
            Send reset link
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            <Link href="/login" className="font-medium text-primary hover:underline">
              Back to sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

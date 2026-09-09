'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { authApi } from '@/features/auth/api';
import { type LoginInput, loginSchema } from '@/features/auth/schemas';
import { ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-client';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const login = useMutation({
    mutationFn: (values: LoginInput) => authApi.login(values.email, values.password),
    onSuccess: (me) => {
      queryClient.setQueryData(queryKeys.me, me);
      const next = searchParams.get('next');
      router.replace(next && next.startsWith('/') ? next : '/dashboard');
    },
    onError: (error) => {
      // The API answers a wrong password and an unknown email identically, and
      // so does this screen — no hint about whether the account exists.
      setFormError(
        error instanceof ApiError ? error.message : 'Could not sign in. Please try again.',
      );
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Enter your details to access your organization.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          noValidate
          onSubmit={handleSubmit((values) => {
            setFormError(null);
            login.mutate(values);
          })}
        >
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}

          <FormField label="Email" htmlFor="email" error={errors.email?.message} required>
            <Input
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              {...register('email')}
            />
          </FormField>

          <FormField label="Password" htmlFor="password" error={errors.password?.message} required>
            <Input type="password" autoComplete="current-password" {...register('password')} />
          </FormField>

          <div className="flex justify-end">
            <Link href="/forgot-password" className="text-sm text-primary hover:underline">
              Forgot your password?
            </Link>
          </div>

          <Button type="submit" className="w-full" loading={login.isPending}>
            Sign in
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            New here?{' '}
            <Link href="/register" className="font-medium text-primary hover:underline">
              Create an organization
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

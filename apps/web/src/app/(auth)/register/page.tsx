'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { passwordStrengthScore } from '@pm/validation';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { authApi } from '@/features/auth/api';
import { type RegisterInput, registerSchema } from '@/features/auth/schemas';
import { ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-client';
import { cn } from '@/lib/utils';

const STRENGTH_LABELS = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'];

export default function RegisterPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { organizationName: '', fullName: '', email: '', password: '', confirmPassword: '' },
  });

  const password = watch('password');
  const strength = password ? passwordStrengthScore(password) : 0;

  const createAccount = useMutation({
    mutationFn: (values: RegisterInput) =>
      authApi.register({
        organizationName: values.organizationName,
        fullName: values.fullName,
        email: values.email,
        password: values.password,
      }),
    onSuccess: (me) => {
      queryClient.setQueryData(queryKeys.me, me);
      router.replace('/dashboard');
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        // Attach field-level messages from the API to the right inputs.
        const fieldErrors = error.fieldErrors;
        let attached = false;
        for (const [field, message] of Object.entries(fieldErrors)) {
          if (field in ({} as RegisterInput) || ['email', 'password', 'fullName', 'organizationName'].includes(field)) {
            setError(field as keyof RegisterInput, { message });
            attached = true;
          }
        }
        if (!attached) setFormError(error.message);
        return;
      }
      setFormError('Could not create your account. Please try again.');
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your organization</CardTitle>
        <CardDescription>
          You will be the owner, with full access to properties, staff and finances.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          noValidate
          onSubmit={handleSubmit((values) => {
            setFormError(null);
            createAccount.mutate(values);
          })}
        >
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}

          <FormField
            label="Organization name"
            htmlFor="organizationName"
            error={errors.organizationName?.message}
            hint="The business that owns or manages the properties."
            required
          >
            <Input autoComplete="organization" placeholder="ABC Properties" {...register('organizationName')} />
          </FormField>

          <FormField label="Your full name" htmlFor="fullName" error={errors.fullName?.message} required>
            <Input autoComplete="name" placeholder="Amina Ochieng" {...register('fullName')} />
          </FormField>

          <FormField label="Email" htmlFor="email" error={errors.email?.message} required>
            <Input type="email" autoComplete="email" placeholder="you@company.com" {...register('email')} />
          </FormField>

          <FormField
            label="Password"
            htmlFor="password"
            error={errors.password?.message}
            hint="At least 12 characters, with upper case, lower case and a number."
            required
          >
            <Input type="password" autoComplete="new-password" {...register('password')} />
          </FormField>

          {password ? (
            <div className="space-y-1">
              <div className="flex gap-1" aria-hidden>
                {[0, 1, 2, 3].map((index) => (
                  <span
                    key={index}
                    className={cn(
                      'h-1 flex-1 rounded-full',
                      index < strength
                        ? strength <= 1
                          ? 'bg-destructive'
                          : strength === 2
                            ? 'bg-warning'
                            : 'bg-success'
                        : 'bg-muted',
                    )}
                  />
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Password strength: {STRENGTH_LABELS[strength]}
              </p>
            </div>
          ) : null}

          <FormField
            label="Confirm password"
            htmlFor="confirmPassword"
            error={errors.confirmPassword?.message}
            required
          >
            <Input type="password" autoComplete="new-password" {...register('confirmPassword')} />
          </FormField>

          <Button type="submit" className="w-full" loading={createAccount.isPending}>
            Create organization
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link href="/login" className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

'use client';

import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { authApi } from '@/features/auth/api';
import { ApiError } from '@/lib/api-client';

function VerifyEmail() {
  const token = useSearchParams().get('token') ?? '';
  const attempted = useRef(false);

  const verify = useMutation({ mutationFn: (value: string) => authApi.verifyEmail(value) });

  useEffect(() => {
    // Verification tokens are single-use, so this must fire exactly once even
    // under React's development double-render.
    if (token && !attempted.current) {
      attempted.current = true;
      verify.mutate(token);
    }
  }, [token, verify]);

  if (!token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>This link is not valid</CardTitle>
          <CardDescription>The verification link is missing its token.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/dashboard">Go to dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        {verify.isSuccess ? (
          <>
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-success/10">
              <CheckCircle2 className="h-5 w-5 text-success" aria-hidden />
            </div>
            <CardTitle>Email confirmed</CardTitle>
            <CardDescription>Thanks — your address is verified.</CardDescription>
          </>
        ) : verify.isError ? (
          <>
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
              <XCircle className="h-5 w-5 text-destructive" aria-hidden />
            </div>
            <CardTitle>We couldn&apos;t confirm that link</CardTitle>
            <CardDescription>
              {verify.error instanceof ApiError
                ? verify.error.message
                : 'The link is invalid or has expired.'}
            </CardDescription>
          </>
        ) : (
          <>
            <CardTitle>Confirming your email…</CardTitle>
            <CardDescription>This only takes a moment.</CardDescription>
          </>
        )}
      </CardHeader>
      <CardContent>
        <Button asChild className="w-full" variant={verify.isSuccess ? 'default' : 'outline'}>
          <Link href="/dashboard">Continue to dashboard</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmail />
    </Suspense>
  );
}

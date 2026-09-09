'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/features/auth/use-session';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { isLoading, isSignedIn } = useSession();
  const router = useRouter();

  useEffect(() => {
    // The API is what actually refuses access; this only keeps the browser from
    // sitting on a shell it cannot fill.
    if (!isLoading && !isSignedIn) router.replace('/login');
  }, [isLoading, isSignedIn, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen">
        <div className="hidden w-64 border-r p-4 lg:block">
          <Skeleton className="h-10 w-full" />
        </div>
        <div className="flex-1 p-6">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="mt-6 h-40 w-full" />
        </div>
      </div>
    );
  }

  if (!isSignedIn) return null;

  return (
    <div className="flex min-h-screen bg-muted/30">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 px-4 py-6 lg:px-8">
          <div className="mx-auto w-full max-w-7xl space-y-6">{children}</div>
        </main>
      </div>
    </div>
  );
}

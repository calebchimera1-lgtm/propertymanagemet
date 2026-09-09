import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm font-semibold text-primary">404</p>
      <h1 className="text-2xl font-semibold">We couldn&apos;t find that page</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        The page may have been moved, or you may not have access to it.
      </p>
      <Button asChild>
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </main>
  );
}

import { Building2 } from 'lucide-react';
import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-muted/40">
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <Link href="/login" className="mb-8 flex items-center justify-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Building2 className="h-5 w-5" aria-hidden />
            </span>
            <span className="text-lg font-semibold">Property Management</span>
          </Link>
          {children}
        </div>
      </main>
      <footer className="px-4 pb-8 text-center text-xs text-muted-foreground">
        Manage properties, tenants, leases and rent in one place.
      </footer>
    </div>
  );
}

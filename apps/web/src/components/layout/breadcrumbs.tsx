'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight } from 'lucide-react';

const LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  users: 'Users',
  settings: 'Settings',
  profile: 'Profile',
  properties: 'Properties',
  buildings: 'Buildings',
  units: 'Units',
};

/** A cuid segment is a record id, not a page name — show it as one. */
function isRecordId(segment: string): boolean {
  return /^c[a-z0-9]{20,}$/i.test(segment);
}

function labelFor(segment: string): string {
  if (LABELS[segment]) return LABELS[segment];
  if (isRecordId(segment)) return 'Details';
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex items-center gap-1 text-sm">
        {segments.map((segment, index) => {
          const href = `/${segments.slice(0, index + 1).join('/')}`;
          const isLast = index === segments.length - 1;

          return (
            <li key={href} className="flex min-w-0 items-center gap-1">
              {index > 0 ? (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              ) : null}
              {isLast ? (
                <span aria-current="page" className="truncate font-medium">
                  {labelFor(segment)}
                </span>
              ) : (
                <Link href={href} className="truncate text-muted-foreground hover:text-foreground">
                  {labelFor(segment)}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

'use client';

import { Bell } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useUnreadNotifications } from '@/features/operations/queries';

/**
 * The unread badge.
 *
 * Polls once a minute rather than holding a socket open — the number changes a
 * few times a day, and the polling contract can become SSE later without
 * touching anything else.
 *
 * Shows nothing at all while loading or on error: a badge that flickers to zero
 * during a failed request would tell people there is nothing to look at.
 */
export function NotificationBell() {
  const { data } = useUnreadNotifications();
  const count = data?.count ?? 0;

  return (
    <Button variant="ghost" size="icon" asChild aria-label={
      count > 0 ? `Notifications, ${count} unread` : 'Notifications'
    }>
      <Link href="/notifications" className="relative">
        <Bell className="h-5 w-5" aria-hidden />
        {count > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground">
            {count > 99 ? '99+' : count}
          </span>
        ) : null}
      </Link>
    </Button>
  );
}

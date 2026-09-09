'use client';

import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ShieldCheck, Users as UsersIcon } from 'lucide-react';
import Link from 'next/link';
import type { Paginated } from '@pm/types';
import { PageHeader } from '@/components/layout/page-header';
import { UPCOMING_SECTIONS } from '@/components/layout/nav-items';
import { CardSkeleton } from '@/components/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSession } from '@/features/auth/use-session';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-client';
import { formatDateTime } from '@/lib/utils';

/**
 * Phase 1 dashboard.
 *
 * Every figure here is read from the API. There are no portfolio metrics yet
 * because there are no properties yet — showing an occupancy rate of 0% over an
 * empty database would be a made-up number dressed as a real one. The metric
 * cards and charts arrive in Phase 6, on top of Phase 2-5 data.
 */
export default function DashboardPage() {
  const { me, can } = useSession();

  const users = useQuery({
    queryKey: queryKeys.users({ limit: 1 }),
    queryFn: () => api.get<Paginated<unknown>>('/users', { query: { limit: 1 } }),
    enabled: can('staff.view'),
  });

  const sessions = useQuery({
    queryKey: queryKeys.sessions,
    queryFn: () => api.get<{ id: string }[]>('/auth/sessions'),
  });

  if (!me) return <CardSkeleton />;

  return (
    <>
      <PageHeader
        title={`Welcome, ${me.user.fullName.split(' ')[0]}`}
        description={`${me.organization.name} · ${me.organization.currency} · ${me.organization.timezone}`}
      />

      {!me.user.emailVerified ? (
        <Alert variant="warning">
          <AlertDescription>
            Your email address is not confirmed yet. Email delivery is not enabled in this version —
            the confirmation link is written to the API server log.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Your role</CardDescription>
            <CardTitle className="text-2xl">{me.roles.join(', ')}</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4" aria-hidden />
            {me.permissions.length} permissions granted
          </CardContent>
        </Card>

        {can('staff.view') ? (
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>People in your organization</CardDescription>
              <CardTitle className="text-2xl">
                {users.isLoading ? '—' : (users.data?.meta.total ?? 0)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline" size="sm">
                <Link href="/users">
                  <UsersIcon className="h-4 w-4" aria-hidden />
                  View users
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Active sessions</CardDescription>
            <CardTitle className="text-2xl">
              {sessions.isLoading ? '—' : (sessions.data?.length ?? 0)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Last signed in {formatDateTime(me.user.lastLoginAt)}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>What is available so far</CardTitle>
          <CardDescription>
            Phase 1 delivers the foundation: accounts, organizations, sessions, roles and
            permissions. The sections below are built in later phases and are not shown in the
            navigation until they work.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-3 sm:grid-cols-2">
            <li className="flex items-start gap-3 rounded-md border bg-background p-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
              <div>
                <p className="text-sm font-medium">Accounts, sessions and permissions</p>
                <p className="text-xs text-muted-foreground">Available now</p>
              </div>
            </li>
            {UPCOMING_SECTIONS.map((section) => (
              <li
                key={section.label}
                className="flex items-start gap-3 rounded-md border border-dashed p-3"
              >
                <section.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-muted-foreground">
                    {section.label}
                  </p>
                  <Badge variant="secondary" className="mt-1">
                    {section.phase}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}

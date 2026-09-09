'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search, Users as UsersIcon } from 'lucide-react';
import { useState } from 'react';
import type { Paginated, RoleName } from '@pm/types';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useDebounced } from '@/hooks/use-debounced';
import { ApiError, api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-client';
import { formatDateTime } from '@/lib/utils';

interface UserRow {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  status: string;
  emailVerified: boolean;
  lastLoginAt: string | null;
  roles: RoleName[];
}

const PAGE_SIZE = 20;

export default function UsersPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounced(search, 300);

  const params = { page, limit: PAGE_SIZE, search: debouncedSearch };

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.users(params),
    queryFn: () => api.get<Paginated<UserRow>>('/users', { query: params }),
    // Keeps the previous page on screen while the next one loads, so the table
    // does not flash empty on every keystroke.
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Users"
        description="People with access to this organization. Creating staff and assigning them to properties arrives in Phase 5."
      />

      <div className="relative max-w-sm">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          className="pl-9"
          placeholder="Search by name or email"
          value={search}
          aria-label="Search users"
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
      </div>

      {isLoading ? (
        <TableSkeleton rows={4} columns={4} />
      ) : isError ? (
        <ErrorState
          description={
            error instanceof ApiError ? error.message : 'The user list could not be loaded.'
          }
          requestId={error instanceof ApiError ? error.requestId : undefined}
          onRetry={() => void refetch()}
        />
      ) : !data || data.data.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title={debouncedSearch ? 'No users match that search' : 'No users yet'}
          description={
            debouncedSearch
              ? 'Try a different name or email address.'
              : 'People you invite to your organization will appear here.'
          }
        />
      ) : (
        <>
          {/* Desktop: a table. Mobile: stacked cards — the same data, laid out
              for the screen rather than a shrunken table. */}
          <Card className="hidden md:block">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/50 text-left">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-medium">Name</th>
                      <th scope="col" className="px-4 py-3 font-medium">Role</th>
                      <th scope="col" className="px-4 py-3 font-medium">Status</th>
                      <th scope="col" className="px-4 py-3 font-medium">Last sign-in</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.map((user) => (
                      <tr key={user.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <div className="font-medium">{user.fullName}</div>
                          <div className="text-xs text-muted-foreground">{user.email}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {user.roles.map((role) => (
                              <Badge key={role} variant="secondary">
                                {role.replace(/_/g, ' ').toLowerCase()}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={user.status === 'ACTIVE' ? 'success' : 'secondary'}>
                            {user.status.toLowerCase()}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {formatDateTime(user.lastLoginAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-3 md:hidden">
            {data.data.map((user) => (
              <Card key={user.id}>
                <CardContent className="space-y-2 p-4">
                  <div>
                    <p className="font-medium">{user.fullName}</p>
                    <p className="text-xs text-muted-foreground">{user.email}</p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {user.roles.map((role) => (
                      <Badge key={role} variant="secondary">
                        {role.replace(/_/g, ' ').toLowerCase()}
                      </Badge>
                    ))}
                    <Badge variant={user.status === 'ACTIVE' ? 'success' : 'secondary'}>
                      {user.status.toLowerCase()}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Last sign-in {formatDateTime(user.lastLoginAt)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="flex items-center justify-between text-sm">
            <p className="text-muted-foreground">
              Page {data.meta.page} of {data.meta.totalPages} · {data.meta.total} user
              {data.meta.total === 1 ? '' : 's'}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={data.meta.page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={data.meta.page >= data.meta.totalPages}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

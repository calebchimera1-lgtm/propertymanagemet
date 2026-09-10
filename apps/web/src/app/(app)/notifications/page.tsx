'use client';

import { Bell, CheckCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/states';
import { DataTablePagination } from '@/components/data-table/pagination';
import { FilterSelect } from '@/components/data-table/toolbar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useTableParams } from '@/components/data-table/use-table-params';
import {
  NOTIFICATION_LABELS,
  notificationHref,
} from '@/features/operations/labels';
import { useNotificationMutations, useNotifications } from '@/features/operations/queries';
import { ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/utils';
import { cn } from '@/lib/utils';

export default function NotificationsPage() {
  const table = useTableParams({ limit: 25 });
  const [unreadOnly, setUnreadOnly] = useState<string | undefined>(undefined);

  const query = { page: table.page, limit: 25, ...(unreadOnly ? { unreadOnly } : {}) };
  const { data, isLoading, isError, error, refetch } = useNotifications(query);
  const { markRead, markAllRead } = useNotificationMutations();

  return (
    <>
      <PageHeader
        title="Notifications"
        description="In-app only in this version. Nothing here was sent by email, SMS or WhatsApp."
        actions={
          data && data.unreadCount > 0 ? (
            <Button
              variant="outline"
              loading={markAllRead.isPending}
              onClick={async () => {
                try {
                  const result = await markAllRead.mutateAsync();
                  toast.success(`${result.marked} marked as read.`);
                } catch (mutationError) {
                  toast.error(
                    mutationError instanceof ApiError
                      ? mutationError.message
                      : 'Could not mark them read.',
                  );
                }
              }}
            >
              <CheckCheck className="h-4 w-4" aria-hidden />
              Mark all read
            </Button>
          ) : null
        }
      />

      <div className="flex items-center gap-3">
        <FilterSelect
          label="Show"
          value={unreadOnly}
          onChange={(value) => {
            setUnreadOnly(value);
            table.setPage(1);
          }}
          options={[{ value: 'true', label: 'Unread only' }]}
          allLabel="Everything"
        />
        {data ? (
          <span className="text-sm text-muted-foreground">
            {data.unreadCount} unread of {data.meta.total}
          </span>
        ) : null}
      </div>

      {isLoading ? (
        <TableSkeleton rows={6} columns={2} />
      ) : isError ? (
        <ErrorState
          description={
            error instanceof ApiError ? error.message : 'Notifications could not be loaded.'
          }
          onRetry={() => void refetch()}
        />
      ) : !data || data.data.length === 0 ? (
        <EmptyState
          icon={Bell}
          title={unreadOnly ? 'Nothing unread' : 'No notifications'}
          description={
            unreadOnly
              ? 'You are up to date.'
              : 'Alerts about overdue rent, expiring leases, payments and maintenance appear here. The daily sweeps run each morning.'
          }
        />
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y">
                {data.data.map((notification) => {
                  const href = notificationHref(notification.entityType, notification.entityId);
                  const body = (
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <span
                        className={cn(
                          'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                          notification.readAt ? 'bg-transparent' : 'bg-primary',
                        )}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <div
                          className={cn(
                            'truncate text-sm',
                            notification.readAt ? 'font-normal' : 'font-medium',
                          )}
                        >
                          {notification.title}
                        </div>
                        <div className="truncate text-sm text-muted-foreground">
                          {notification.body}
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <Badge variant="secondary">
                            {NOTIFICATION_LABELS[notification.type]}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {formatDateTime(notification.createdAt)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );

                  return (
                    <li key={notification.id} className="flex items-start gap-3 p-4">
                      {href ? (
                        <Link
                          href={href}
                          className="flex min-w-0 flex-1"
                          onClick={() => {
                            // Opening it is reading it.
                            if (!notification.readAt) markRead.mutate(notification.id);
                          }}
                        >
                          {body}
                        </Link>
                      ) : (
                        body
                      )}
                      {!notification.readAt ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="shrink-0"
                          onClick={() => markRead.mutate(notification.id)}
                        >
                          Mark read
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
          <DataTablePagination
            meta={data.meta}
            onPageChange={table.setPage}
            noun="notification"
          />
        </>
      )}
    </>
  );
}

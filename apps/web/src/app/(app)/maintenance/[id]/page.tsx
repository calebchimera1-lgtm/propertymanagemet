'use client';

import { ArrowLeft, MessageSquarePlus, Pencil, UserCog } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { CardSkeleton, ErrorState } from '@/components/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSession } from '@/features/auth/use-session';
import {
  AddNoteDialog,
  AssignMaintenanceDialog,
  ChangeStatusDialog,
} from '@/features/operations/components/maintenance-actions';
import { MaintenanceFormDialog } from '@/features/operations/components/maintenance-form-dialog';
import {
  ALLOWED_TRANSITIONS,
  MAINTENANCE_STATUS_LABELS,
  MAINTENANCE_STATUS_VARIANTS,
  PRIORITY_LABELS,
  PRIORITY_VARIANTS,
  isClosed,
} from '@/features/operations/labels';
import { useMaintenanceRequest } from '@/features/operations/queries';
import type { MaintenanceStatus } from '@/features/operations/types';
import { ApiError } from '@/lib/api-client';
import { formatDateTime, formatMoney } from '@/lib/utils';

export default function MaintenanceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can, me } = useSession();
  const currency = me?.organization.currency ?? 'KES';

  const request = useMaintenanceRequest(id);
  const [editOpen, setEditOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [statusTarget, setStatusTarget] = useState<MaintenanceStatus | null>(null);

  if (request.isLoading) return <CardSkeleton count={3} />;

  if (request.isError || !request.data) {
    return (
      <ErrorState
        title="Request unavailable"
        description={
          request.error instanceof ApiError && request.error.status === 404
            ? 'This request does not exist, or is not one you have access to.'
            : 'The request could not be loaded.'
        }
        onRetry={() => void request.refetch()}
      />
    );
  }

  const record = request.data;
  const closed = isClosed(record.status);
  const transitions = ALLOWED_TRANSITIONS[record.status];

  return (
    <>
      <PageHeader
        title={record.title}
        description={
          <>
            <Link
              href={`/properties/${record.propertyId}`}
              className="text-primary hover:underline"
            >
              {record.property.name}
            </Link>
            {record.unit ? ` · unit ${record.unit.unitNumber}` : ' · whole property'}
            {record.reportedBy ? ` · raised by ${record.reportedBy.fullName}` : ''}
          </>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {can('maintenance.update') && !closed ? (
              <>
                <Button variant="outline" onClick={() => setAssignOpen(true)}>
                  <UserCog className="h-4 w-4" aria-hidden />
                  Assign
                </Button>
                <Button variant="outline" onClick={() => setEditOpen(true)}>
                  <Pencil className="h-4 w-4" aria-hidden />
                  Edit
                </Button>
              </>
            ) : null}
            {can('maintenance.update') ? (
              <Button variant="outline" onClick={() => setNoteOpen(true)}>
                <MessageSquarePlus className="h-4 w-4" aria-hidden />
                Add note
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={MAINTENANCE_STATUS_VARIANTS[record.status]}>
          {MAINTENANCE_STATUS_LABELS[record.status]}
        </Badge>
        <Badge variant={PRIORITY_VARIANTS[record.priority]}>
          {PRIORITY_LABELS[record.priority]}
        </Badge>
        {record.assignedTo ? (
          <span className="text-sm text-muted-foreground">
            Assigned to {record.assignedTo.fullName}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">Not assigned to anyone</span>
        )}
      </div>

      {closed ? (
        <Alert variant="info">
          <AlertDescription>
            This request is {MAINTENANCE_STATUS_LABELS[record.status].toLowerCase()} and cannot be
            reopened or edited. If the same fault returns, raise a new request — that keeps each
            job&rsquo;s cost and timeline its own.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Only moves the API will accept are offered. A button that returns 409
          teaches people to distrust the buttons. */}
      {can('maintenance.update') && transitions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {transitions.map((status) => (
            <Button
              key={status}
              variant={status === 'CANCELLED' ? 'ghost' : 'default'}
              size="sm"
              onClick={() => setStatusTarget(status)}
            >
              Mark {MAINTENANCE_STATUS_LABELS[status].toLowerCase()}
            </Button>
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">What was reported</CardTitle>
          </CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm">{record.description}</CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Cost</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {record.actualCost
                ? formatMoney(record.actualCost, currency)
                : record.estimatedCost
                  ? formatMoney(record.estimatedCost, currency)
                  : '—'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-muted-foreground">
            <div>
              {record.actualCost
                ? 'Actual'
                : record.estimatedCost
                  ? 'Estimated — not yet final'
                  : 'Nothing recorded'}
            </div>
            {record.actualCost && record.estimatedCost ? (
              <div>Estimated {formatMoney(record.estimatedCost, currency)}</div>
            ) : null}
            {record.actualCost ? (
              <div className="pt-2">
                {/* Said plainly: the cost on a job is not an expense until
                    someone records it as one. */}
                Recorded here only. Add it under Expenses to include it in the
                accounts.
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Timeline</CardTitle>
          <CardDescription>
            Every status change and note, oldest first. Nothing here can be edited or removed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="relative space-y-4 border-l pl-6">
            {record.updates.map((update) => (
              <li key={update.id} className="relative">
                <span
                  className="absolute -left-[1.6rem] top-1.5 h-2.5 w-2.5 rounded-full bg-border"
                  aria-hidden
                />
                <div className="text-sm">{update.note}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {update.author?.fullName ?? 'System'} · {formatDateTime(update.createdAt)}
                  {update.fromStatus && update.toStatus ? (
                    <>
                      {' · '}
                      {MAINTENANCE_STATUS_LABELS[update.fromStatus]} →{' '}
                      {MAINTENANCE_STATUS_LABELS[update.toStatus]}
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/maintenance">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to maintenance
          </Link>
        </Button>
      </div>

      <MaintenanceFormDialog open={editOpen} onOpenChange={setEditOpen} request={record} />
      <AssignMaintenanceDialog open={assignOpen} onOpenChange={setAssignOpen} request={record} />
      <AddNoteDialog open={noteOpen} onOpenChange={setNoteOpen} request={record} />
      {statusTarget ? (
        <ChangeStatusDialog
          open={Boolean(statusTarget)}
          onOpenChange={(open) => !open && setStatusTarget(null)}
          request={record}
          target={statusTarget}
        />
      ) : null}
    </>
  );
}

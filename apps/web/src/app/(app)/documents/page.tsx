'use client';

import { Download, FileText, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/states';
import { type Column, DataTable } from '@/components/data-table/data-table';
import { DataTablePagination } from '@/components/data-table/pagination';
import { DataTableToolbar, FilterSelect } from '@/components/data-table/toolbar';
import { useTableParams } from '@/components/data-table/use-table-params';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useSession } from '@/features/auth/use-session';
import { UploadDocumentDialog } from '@/features/operations/components/upload-document-dialog';
import { operationsApi } from '@/features/operations/api';
import { DOCUMENT_ENTITY_LABELS, formatBytes } from '@/features/operations/labels';
import { useDocumentMutations, useDocuments } from '@/features/operations/queries';
import type { DocumentRecord } from '@/features/operations/types';
import { ApiError } from '@/lib/api-client';
import { formatDate } from '@/lib/utils';

export default function DocumentsPage() {
  const { can } = useSession();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleting, setDeleting] = useState<DocumentRecord | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const table = useTableParams({ sortBy: 'createdAt', sortOrder: 'desc' });
  const { data, isLoading, isError, error, refetch } = useDocuments(table.query);
  const { remove } = useDocumentMutations();

  const hasFilters = Boolean(table.search || table.filters.entityType);

  /**
   * Fetches the bytes with the session cookie, then hands them to the browser.
   *
   * A plain link would be an anonymous request and get a 401 — documents are
   * never reachable by URL, which is the point.
   */
  async function download(document: DocumentRecord) {
    setDownloading(document.id);
    try {
      const { blob, filename } = await operationsApi.documents.download(document.id);
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = filename ?? document.originalFilename;
      window.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      toast.error(
        downloadError instanceof ApiError
          ? downloadError.message
          : 'That file could not be downloaded.',
      );
    } finally {
      setDownloading(null);
    }
  }

  const columns: Column<DocumentRecord>[] = [
    {
      header: 'Document',
      sortKey: 'name',
      cell: (document) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{document.name}</div>
          <div className="truncate text-xs text-muted-foreground">{document.originalFilename}</div>
        </div>
      ),
    },
    {
      header: 'Filed against',
      cell: (document) => (
        <Badge variant="secondary">{DOCUMENT_ENTITY_LABELS[document.entityType]}</Badge>
      ),
    },
    {
      header: 'Size',
      sortKey: 'sizeBytes',
      cell: (document) => <span className="tabular-nums">{formatBytes(document.sizeBytes)}</span>,
    },
    {
      header: 'Uploaded',
      sortKey: 'createdAt',
      cell: (document) => (
        <div>
          <div>{formatDate(document.createdAt)}</div>
          <div className="text-xs text-muted-foreground">
            {document.uploadedBy?.fullName ?? 'Unknown'}
          </div>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Documents"
        description="Files kept with the records they belong to. Every download is authorized — there are no public links."
        actions={
          can('documents.upload') ? (
            <Button onClick={() => setUploadOpen(true)}>
              <Upload className="h-4 w-4" aria-hidden />
              Upload
            </Button>
          ) : null
        }
      />

      <DataTableToolbar
        search={table.search}
        onSearchChange={table.onSearchChange}
        searchPlaceholder="Search name or filename"
        hasFilters={hasFilters}
        onClear={() => {
          table.onSearchChange('');
          table.setFilter('entityType', undefined);
        }}
      >
        <FilterSelect
          label="Filed against"
          value={table.filters.entityType}
          onChange={(value) => table.setFilter('entityType', value)}
          options={(
            Object.keys(DOCUMENT_ENTITY_LABELS) as (keyof typeof DOCUMENT_ENTITY_LABELS)[]
          ).map((value) => ({ value, label: DOCUMENT_ENTITY_LABELS[value] }))}
          allLabel="Everything"
        />
      </DataTableToolbar>

      {isLoading ? (
        <TableSkeleton rows={5} columns={4} />
      ) : isError ? (
        <ErrorState
          description={error instanceof ApiError ? error.message : 'Documents could not be loaded.'}
          onRetry={() => void refetch()}
        />
      ) : !data || data.data.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={hasFilters ? 'No documents match these filters' : 'No documents yet'}
          description={
            hasFilters
              ? 'Try a different search or clear the filters.'
              : 'Upload leases, ID copies, receipts and certificates, and file them against the property, unit or tenant they belong to.'
          }
          action={
            can('documents.upload') && !hasFilters ? (
              <Button onClick={() => setUploadOpen(true)}>
                <Upload className="h-4 w-4" aria-hidden />
                Upload
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <DataTable
            rows={data.data}
            columns={columns}
            rowKey={(document) => document.id}
            sortBy={table.sortBy}
            sortOrder={table.sortOrder}
            onSort={table.toggleSort}
            rowActions={(document) => (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  loading={downloading === document.id}
                  onClick={() => void download(document)}
                >
                  <Download className="h-4 w-4" aria-hidden />
                  <span className="sr-only sm:not-sr-only">Download</span>
                </Button>
                {can('documents.delete') ? (
                  <Button variant="ghost" size="sm" onClick={() => setDeleting(document)}>
                    <Trash2 className="h-4 w-4 text-destructive" aria-hidden />
                    <span className="sr-only">Delete</span>
                  </Button>
                ) : null}
              </div>
            )}
          />
          <DataTablePagination meta={data.meta} onPageChange={table.setPage} noun="document" />
        </>
      )}

      <UploadDocumentDialog open={uploadOpen} onOpenChange={setUploadOpen} />

      {deleting ? (
        <ConfirmDialog
          open={Boolean(deleting)}
          onOpenChange={(open) => !open && setDeleting(null)}
          title={`Delete "${deleting.name}"?`}
          description="The file and its record are removed for good. This cannot be undone."
          confirmLabel="Delete document"
          destructive
          loading={remove.isPending}
          onConfirm={async () => {
            try {
              await remove.mutateAsync(deleting.id);
              toast.success('Document deleted.');
              setDeleting(null);
            } catch (mutationError) {
              toast.error(
                mutationError instanceof ApiError
                  ? mutationError.message
                  : 'Could not delete the document.',
              );
            }
          }}
        />
      ) : null}
    </>
  );
}

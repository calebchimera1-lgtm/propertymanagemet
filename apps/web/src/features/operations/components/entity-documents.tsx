'use client';

import { Download, FileText, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useSession } from '@/features/auth/use-session';
import { ApiError } from '@/lib/api-client';
import { formatDate } from '@/lib/utils';
import { operationsApi } from '../api';
import { formatBytes } from '../labels';
import { useDocumentMutations, useDocuments } from '../queries';
import type { DocumentEntityType, DocumentRecord } from '../types';
import { UploadDocumentDialog } from './upload-document-dialog';

/**
 * The documents filed against one record, shown on that record's own page.
 *
 * A file only means something next to the thing it describes, so this panel
 * drops into a tenant profile or a property detail rather than making people go
 * to a global list and filter it back down.
 */
export function EntityDocuments({
  entityType,
  entityId,
  label,
}: {
  entityType: DocumentEntityType;
  entityId: string;
  label: string;
}) {
  const { can } = useSession();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleting, setDeleting] = useState<DocumentRecord | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const query = { entityType, entityId, limit: 50, sortBy: 'createdAt', sortOrder: 'desc' };
  const { data, isLoading, isError } = useDocuments(query);
  const { remove } = useDocumentMutations();

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
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'That file could not be downloaded.',
      );
    } finally {
      setDownloading(null);
    }
  }

  if (!can('documents.view')) return null;

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Documents</CardTitle>
            <CardDescription>Files kept with this record.</CardDescription>
          </div>
          {can('documents.upload') ? (
            <Button variant="outline" size="sm" onClick={() => setUploadOpen(true)}>
              <Upload className="h-4 w-4" aria-hidden />
              Upload
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading documents…</p>
          ) : isError ? (
            // Never a silent empty list: "none uploaded" and "could not load"
            // are different facts.
            <p className="text-sm text-destructive">Documents could not be loaded.</p>
          ) : !data || data.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing filed here yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {data.data.map((document) => (
                <li key={document.id} className="flex items-center gap-3 py-2.5">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{document.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {formatBytes(document.sizeBytes)} · {formatDate(document.createdAt)}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={downloading === document.id}
                    onClick={() => void download(document)}
                  >
                    <Download className="h-4 w-4" aria-hidden />
                    <span className="sr-only">Download {document.name}</span>
                  </Button>
                  {can('documents.delete') ? (
                    <Button variant="ghost" size="sm" onClick={() => setDeleting(document)}>
                      <Trash2 className="h-4 w-4 text-destructive" aria-hidden />
                      <span className="sr-only">Delete {document.name}</span>
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <UploadDocumentDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        fixedEntity={{ entityType, entityId, label }}
      />

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
            } catch (error) {
              toast.error(
                error instanceof ApiError ? error.message : 'Could not delete the document.',
              );
            }
          }}
        />
      ) : null}
    </>
  );
}

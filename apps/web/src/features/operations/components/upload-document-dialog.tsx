'use client';

import { UploadCloud } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type * as React from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FormDialog } from '@/features/portfolio/components/form-dialog';
import { useProperties, useUnits } from '@/features/portfolio/queries';
import { useTenants } from '@/features/occupancy/queries';
import { ApiError } from '@/lib/api-client';
import { ALLOWED_UPLOAD_EXTENSIONS, DOCUMENT_ENTITY_LABELS, formatBytes } from '../labels';
import { useDocumentMutations } from '../queries';
import type { DocumentEntityType } from '../types';

/** Kept in step with MAX_UPLOAD_SIZE_MB; the server is what enforces it. */
const MAX_BYTES = 10 * 1024 * 1024;

/** The record types this dialog can pick a record for. */
const PICKABLE: DocumentEntityType[] = ['PROPERTY', 'UNIT', 'TENANT', 'ORGANIZATION'];

export function UploadDocumentDialog({
  open,
  onOpenChange,
  fixedEntity,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selects and locks the record, for uploading from a detail page. */
  fixedEntity?: { entityType: DocumentEntityType; entityId: string; label: string };
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const [entityType, setEntityType] = useState<DocumentEntityType>('ORGANIZATION');
  const [entityId, setEntityId] = useState<string>('');
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { upload } = useDocumentMutations();

  const properties = useProperties({ limit: 100, sortBy: 'name', sortOrder: 'asc' });
  const units = useUnits(
    { limit: 100, sortBy: 'unitNumber', sortOrder: 'asc' },
    open && entityType === 'UNIT' && !fixedEntity,
  );
  const tenants = useTenants(
    { limit: 100, sortBy: 'fullName', sortOrder: 'asc' },
    open && entityType === 'TENANT' && !fixedEntity,
  );

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    setEntityType(fixedEntity?.entityType ?? 'ORGANIZATION');
    setEntityId(fixedEntity?.entityId ?? '');
    setName('');
    setFile(null);
    if (fileInput.current) fileInput.current.value = '';
  }, [open, fixedEntity]);

  const needsRecord = entityType !== 'ORGANIZATION';

  const options =
    entityType === 'PROPERTY'
      ? (properties.data?.data ?? []).map((p) => ({ value: p.id, label: p.name }))
      : entityType === 'UNIT'
        ? (units.data?.data ?? []).map((u) => ({
            value: u.id,
            label: `${u.unitNumber} · ${u.property?.name ?? ''}`,
          }))
        : entityType === 'TENANT'
          ? (tenants.data?.data ?? []).map((t) => ({ value: t.id, label: t.fullName }))
          : [];

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    if (!file) {
      setFormError('Choose a file to upload.');
      return;
    }
    // Checked here for a fast answer; the server checks again, and the server
    // is the one that decides.
    if (file.size > MAX_BYTES) {
      setFormError(`That file is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_BYTES)}.`);
      return;
    }
    if (needsRecord && !entityId) {
      setFormError('Choose the record this document belongs to.');
      return;
    }

    const form = new FormData();
    form.append('file', file);
    form.append('entityType', entityType);
    if (needsRecord) form.append('entityId', entityId);
    if (name.trim()) form.append('name', name.trim());

    try {
      await upload.mutateAsync(form);
      toast.success('Document uploaded.');
      onOpenChange(false);
    } catch (error) {
      setFormError(
        error instanceof ApiError ? error.message : 'Could not upload the file. Please try again.',
      );
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Upload a document"
      description={
        fixedEntity
          ? `Filed against ${fixedEntity.label}.`
          : 'Leases, receipts, photos, certificates — anything worth keeping with the record it belongs to.'
      }
      formError={formError}
      submitting={upload.isPending}
      submitLabel="Upload"
      onSubmit={onSubmit}
    >
      <FormField
        label="File"
        htmlFor="file"
        hint={`Up to ${formatBytes(MAX_BYTES)}. Accepted: ${ALLOWED_UPLOAD_EXTENSIONS.join(', ')}.`}
        required
      >
        <Input
          id="file"
          type="file"
          ref={fileInput}
          accept={ALLOWED_UPLOAD_EXTENSIONS.join(',')}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </FormField>

      {file ? (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-3 text-sm">
          <UploadCloud className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 truncate">{file.name}</span>
          <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
            {formatBytes(file.size)}
          </span>
        </div>
      ) : null}

      {!fixedEntity ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Belongs to" htmlFor="entityType" required>
            <Select
              value={entityType}
              onValueChange={(value) => {
                setEntityType(value as DocumentEntityType);
                // The old record belongs to the old type.
                setEntityId('');
              }}
            >
              <SelectTrigger id="entityType">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PICKABLE.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value === 'ORGANIZATION'
                      ? 'The organization'
                      : DOCUMENT_ENTITY_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          {needsRecord ? (
            <FormField label="Record" htmlFor="entityId" required>
              <Select value={entityId} onValueChange={setEntityId}>
                <SelectTrigger id="entityId">
                  <SelectValue placeholder="Choose a record" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          ) : null}
        </div>
      ) : null}

      <FormField label="Name" htmlFor="name" hint="Defaults to the filename.">
        <Input
          id="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Signed lease"
        />
      </FormField>

      <Alert variant="info">
        <AlertDescription>
          Files are checked by their real contents, not just their name — a renamed script is
          refused. Downloads are always sent as attachments, never opened in the browser.
        </AlertDescription>
      </Alert>
    </FormDialog>
  );
}

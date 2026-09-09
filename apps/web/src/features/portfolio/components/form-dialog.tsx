'use client';

import type * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';

/**
 * Shared shell for the three portfolio forms so they cannot drift apart in
 * layout, button order or how a form-level error is shown.
 */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  formError,
  submitting,
  submitLabel,
  onSubmit,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  formError?: string | null;
  submitting: boolean;
  submitLabel: string;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        <form className="space-y-4" noValidate onSubmit={onSubmit}>
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}

          {children}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Maps an ApiError's field details onto react-hook-form, returning any leftover. */
export function applyFieldErrors(
  fieldErrors: Record<string, string>,
  setError: (field: never, error: { message: string }) => void,
  known: string[],
): boolean {
  let attached = false;
  for (const [field, message] of Object.entries(fieldErrors)) {
    if (known.includes(field)) {
      setError(field as never, { message });
      attached = true;
    }
  }
  return attached;
}

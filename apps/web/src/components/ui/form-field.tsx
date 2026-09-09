'use client';

import * as React from 'react';
import { Label } from './label';
import { cn } from '@/lib/utils';

interface FormFieldProps {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

/**
 * One consistent field layout: label, control, hint, error.
 *
 * The error is wired to the control with aria-describedby and announced
 * politely, so it reaches a screen reader rather than only being red.
 */
export function FormField({
  label,
  htmlFor,
  error,
  hint,
  required,
  className,
  children,
}: FormFieldProps) {
  const errorId = `${htmlFor}-error`;
  const hintId = `${htmlFor}-hint`;

  return (
    <div className={cn('space-y-2', className)}>
      {/*
        The asterisk sits OUTSIDE the label element on purpose. Inside it, it
        becomes part of the field's accessible name ("Password*"), which breaks
        both screen-reader announcements and any test that looks a field up by
        its label. Requiredness is conveyed to assistive technology by the
        control's own required attribute instead.
      */}
      <div className="flex items-center gap-1">
        <Label htmlFor={htmlFor}>{label}</Label>
        {required ? (
          <span className="text-destructive" aria-hidden>
            *
          </span>
        ) : null}
      </div>

      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
            id: htmlFor,
            required: required || undefined,
            'aria-invalid': error ? true : undefined,
            'aria-describedby': error ? errorId : hint ? hintId : undefined,
          })
        : children}

      {hint && !error ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

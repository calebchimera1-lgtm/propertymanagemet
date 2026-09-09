'use client';

import type { PaginationMeta } from '@pm/types';
import { Button } from '@/components/ui/button';

export function DataTablePagination({
  meta,
  onPageChange,
  noun = 'record',
  // Passed explicitly rather than derived: "property" does not pluralise by
  // adding an s, and a guessy pluraliser is worse than an argument.
  nounPlural,
}: {
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
  noun?: string;
  nounPlural?: string;
}) {
  const label = meta.total === 1 ? noun : (nounPlural ?? `${noun}s`);

  return (
    <div className="flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <p className="text-muted-foreground">
        Page {meta.page} of {meta.totalPages} · {meta.total} {label}
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={meta.page <= 1}
          onClick={() => onPageChange(Math.max(1, meta.page - 1))}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={meta.page >= meta.totalPages}
          onClick={() => onPageChange(meta.page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

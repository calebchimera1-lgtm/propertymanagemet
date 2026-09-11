import type { Prisma } from '@pm/database';
import type { ScopedPrismaClient } from '@/prisma/tenant-scope.extension';
import type { ReportFiltersDto } from './dto/report.dto';

/** How a column should be rendered, on screen and on paper alike. */
export type ColumnFormat = 'text' | 'money' | 'date' | 'number' | 'percent';

export interface ReportColumn {
  key: string;
  label: string;
  format?: ColumnFormat;
  /** Right-align and total this column. Money and number columns default to true. */
  numeric?: boolean;
}

/**
 * A row is a flat bag of primitives.
 *
 * Deliberately not a nested object: the same rows go to the screen, to a CSV
 * and to a PDF, and a shape that only one of the three can render would let
 * them drift apart.
 */
export type ReportRow = Record<string, string | number | null>;

export interface ReportResult {
  columns: ReportColumn[];
  rows: ReportRow[];
  /** Column key → total, already serialised. Money totals are fixed-scale strings. */
  totals: Record<string, string | number>;
  meta: {
    /** Rows matching the filters, which may exceed the page returned. */
    total: number;
    page: number;
    limit: number;
    /** Extra per-report facts: a collection rate, counts by status, and so on. */
    [key: string]: unknown;
  };
}

export interface ReportContext {
  db: ScopedPrismaClient;
  organizationId: string;
  /** null means unrestricted; [] means the caller sees nothing. */
  propertyIds: string[] | null;
  /** Spread into a Prisma `where` on any model with a propertyId column. */
  scopeWhere: { propertyId?: { in: string[] } };
  filters: ReportFiltersDto;
  /** Page bounds, already clamped by the DTO. */
  skip: number;
  take: number;
}

/**
 * One class per report.
 *
 * Each owns its query and its row shape and nothing else: no formatting, no
 * export concerns, and no money arithmetic of its own — totals come from
 * FinanceCalculationService so there is exactly one definition of each figure.
 */
export interface ReportStrategy {
  readonly key: string;
  readonly title: string;
  readonly description: string;
  /** Filters this report actually honours, so the UI shows only those. */
  readonly filters: readonly string[];
  run(context: ReportContext): Promise<ReportResult>;
}

/** Date-range fragment for whichever column the report keys off. */
export function dateRange(
  from: Date | undefined,
  to: Date | undefined,
): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  return { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
}

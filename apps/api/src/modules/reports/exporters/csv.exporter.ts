import { Readable } from 'node:stream';
import { Injectable } from '@nestjs/common';
import type { ReportResult } from '../report.types';

/**
 * Escapes one CSV field.
 *
 * The leading-character guard is the important one. A cell beginning `=`, `+`,
 * `-` or `@` is executed as a formula when the file is opened in Excel or
 * Sheets — so a tenant who names themselves `=HYPERLINK("http://evil","click")`
 * would run something on the landlord's machine. Prefixing an apostrophe
 * neutralises it while leaving the text readable.
 */
export function escapeCsvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';

  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;

  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CRLF, because that is the line ending Excel expects and it is harmless elsewhere. */
export function csvLine(values: (string | number | null | undefined)[]): string {
  return `${values.map(escapeCsvField).join(',')}\r\n`;
}

export interface ExportMeta {
  title: string;
  /** Human-readable filter lines, so the file states what it covers. */
  filters: string[];
  organizationName: string;
  generatedAt: Date;
}

/**
 * CSV, streamed.
 *
 * Rows are pushed as they are produced rather than joined into one string: a
 * fifty-thousand-row export built with `rows.map(...).join('\n')` holds the
 * whole file in memory twice, and that is exactly the export somebody runs at
 * year end on the smallest server they own.
 */
@Injectable()
export class CsvExporter {
  stream(report: ReportResult, meta: ExportMeta): Readable {
    const { columns, rows, totals } = report;

    // -1 header block, 0 column names, 1..n rows, then totals.
    let cursor = -1;

    return new Readable({
      read() {
        if (cursor === -1) {
          this.push(
            [
              `# ${meta.title}\r\n`,
              `# ${meta.organizationName}\r\n`,
              `# Generated ${meta.generatedAt.toISOString()}\r\n`,
              ...meta.filters.map((filter) => `# ${filter}\r\n`),
              '\r\n',
            ].join(''),
          );
          cursor = 0;
          return;
        }

        if (cursor === 0) {
          this.push(csvLine(columns.map((column) => column.label)));
          cursor = 1;
          return;
        }

        const row = rows[cursor - 1];
        if (!row) {
          if (Object.keys(totals).length > 0) {
            // Blank for non-numeric columns, so each figure sits under the
            // column it totals.
            this.push(
              csvLine(
                columns.map((column, position) =>
                  position === 0 ? 'Total' : (totals[column.key] ?? ''),
                ),
              ),
            );
          }
          this.push(null);
          return;
        }

        this.push(csvLine(columns.map((column) => row[column.key] ?? '')));
        cursor++;
      },
    });
  }
}

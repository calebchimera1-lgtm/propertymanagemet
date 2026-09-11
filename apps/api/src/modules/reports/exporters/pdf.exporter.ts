import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import type { ReportColumn, ReportResult } from '../report.types';
import type { ExportMeta } from './csv.exporter';

/**
 * PDF, rendered server-side from the same rows object the screen uses.
 *
 * Rendered here rather than in a headless browser on purpose: a browser would
 * mean a second rendering path, a second set of fonts and a second thing that
 * can disagree with what the user saw. This takes the columns, rows and totals
 * the API already produced and draws them — so screen and paper cannot say
 * different numbers.
 */
@Injectable()
export class PdfExporter {
  private static readonly MARGIN = 36;
  private static readonly ROW_HEIGHT = 18;
  private static readonly HEADER_SIZE = 8;

  /**
   * Column widths, proportional to the content they hold.
   *
   * Numeric columns get a fixed narrow share and text columns split what is
   * left: a table that gave "Description" and "Unit" the same width wastes
   * half the page and truncates the half that matters.
   */
  private widths(columns: ReportColumn[], available: number): number[] {
    const weights = columns.map((column) => {
      if (column.format === 'money') return 1.1;
      if (column.format === 'number' || column.format === 'percent') return 0.7;
      if (column.format === 'date') return 0.9;
      if (column.key === 'description' || column.key === 'title') return 2.2;
      return 1.4;
    });

    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    return weights.map((weight) => (weight / totalWeight) * available);
  }

  render(report: ReportResult, meta: ExportMeta): NodeJS.ReadableStream {
    const { columns, rows, totals } = report;

    const document = new PDFDocument({
      // Landscape: these are wide tables, and a portrait page would either
      // truncate columns or shrink them past reading.
      size: 'A4',
      layout: 'landscape',
      margin: PdfExporter.MARGIN,
      info: { Title: meta.title, Author: meta.organizationName },
    });

    const available = document.page.width - PdfExporter.MARGIN * 2;
    const widths = this.widths(columns, available);

    const drawHeader = (): void => {
      document.font('Helvetica-Bold').fontSize(16).fillColor('#111827');
      document.text(meta.title, PdfExporter.MARGIN, PdfExporter.MARGIN);

      document.font('Helvetica').fontSize(9).fillColor('#4b5563');
      document.text(meta.organizationName);
      document.text(`Generated ${meta.generatedAt.toISOString().replace('T', ' ').slice(0, 19)} UTC`);

      // The filter set, on the page. A printed report that does not say what
      // it covers cannot be checked by the person holding it.
      for (const filter of meta.filters) document.text(filter);

      document.moveDown(0.6);
    };

    const drawColumnHeadings = (): number => {
      const top = document.y;
      document.font('Helvetica-Bold').fontSize(PdfExporter.HEADER_SIZE).fillColor('#111827');

      let x = PdfExporter.MARGIN;
      columns.forEach((column, index) => {
        document.text(column.label, x + 2, top + 5, {
          width: widths[index]! - 4,
          align: column.numeric ? 'right' : 'left',
          lineBreak: false,
        });
        x += widths[index]!;
      });

      const bottom = top + PdfExporter.ROW_HEIGHT;
      document
        .moveTo(PdfExporter.MARGIN, bottom)
        .lineTo(document.page.width - PdfExporter.MARGIN, bottom)
        .strokeColor('#d1d5db')
        .lineWidth(0.8)
        .stroke();

      document.y = bottom;
      return bottom;
    };

    const pageBottom = document.page.height - PdfExporter.MARGIN - PdfExporter.ROW_HEIGHT;

    drawHeader();
    drawColumnHeadings();

    document.font('Helvetica').fontSize(PdfExporter.HEADER_SIZE).fillColor('#111827');

    if (rows.length === 0) {
      // An explicit statement, not a blank page. "No records" and "the export
      // broke" must not look the same.
      document.moveDown(1);
      document
        .fillColor('#6b7280')
        .text('No records match these filters.', PdfExporter.MARGIN, document.y + 8);
    }

    for (const [index, row] of rows.entries()) {
      if (document.y > pageBottom) {
        document.addPage();
        drawColumnHeadings();
        document.font('Helvetica').fontSize(PdfExporter.HEADER_SIZE).fillColor('#111827');
      }

      const top = document.y;

      // Zebra striping: at eight point, adjacent rows in a wide table are hard
      // to follow across the page without it.
      if (index % 2 === 1) {
        document
          .rect(PdfExporter.MARGIN, top, available, PdfExporter.ROW_HEIGHT)
          .fillColor('#f9fafb')
          .fill();
        document.fillColor('#111827');
      }

      let x = PdfExporter.MARGIN;
      columns.forEach((column, position) => {
        const value = row[column.key];
        document.text(value === null || value === undefined ? '—' : String(value), x + 2, top + 5, {
          width: widths[position]! - 4,
          align: column.numeric ? 'right' : 'left',
          // No wrapping: a row that grows to three lines breaks the fixed row
          // height and the striping with it. Long text is clipped, and the CSV
          // is the export for reading it in full.
          lineBreak: false,
          ellipsis: true,
        });
        x += widths[position]!;
      });

      document.y = top + PdfExporter.ROW_HEIGHT;
    }

    if (Object.keys(totals).length > 0 && rows.length > 0) {
      if (document.y > pageBottom) document.addPage();

      const top = document.y;
      document
        .moveTo(PdfExporter.MARGIN, top)
        .lineTo(document.page.width - PdfExporter.MARGIN, top)
        .strokeColor('#9ca3af')
        .lineWidth(1)
        .stroke();

      document.font('Helvetica-Bold').fillColor('#111827');

      let x = PdfExporter.MARGIN;
      columns.forEach((column, position) => {
        const value = position === 0 ? 'Total' : totals[column.key];
        document.text(value === undefined ? '' : String(value), x + 2, top + 6, {
          width: widths[position]! - 4,
          align: column.numeric ? 'right' : 'left',
          lineBreak: false,
        });
        x += widths[position]!;
      });
      document.y = top + PdfExporter.ROW_HEIGHT;
    }

    // Page numbers, added once every page exists.
    const range = document.bufferedPageRange();
    for (let page = range.start; page < range.start + range.count; page++) {
      document.switchToPage(page);
      document
        .font('Helvetica')
        .fontSize(7)
        .fillColor('#9ca3af')
        .text(
          `Page ${page - range.start + 1} of ${range.count}`,
          PdfExporter.MARGIN,
          document.page.height - PdfExporter.MARGIN + 8,
          { width: available, align: 'right', lineBreak: false },
        );
    }

    document.end();
    return document;
  }
}

import { CsvExporter, csvLine, escapeCsvField } from './csv.exporter';
import type { ReportResult } from '../report.types';

/**
 * CSV escaping, and the formula-injection guard in particular.
 *
 * A spreadsheet treats a cell beginning `=`, `+`, `-` or `@` as a formula, so a
 * tenant name is an execution vector the moment somebody opens the export. This
 * is the cheapest real vulnerability in the product to get wrong.
 */
describe('CSV export', () => {
  describe('escaping', () => {
    it('leaves ordinary text alone', () => {
      expect(escapeCsvField('Grace Wanjiku')).toBe('Grace Wanjiku');
      expect(escapeCsvField('30000.00')).toBe('30000.00');
      expect(escapeCsvField(42)).toBe('42');
    });

    it('renders null and undefined as an empty cell, not "null"', () => {
      expect(escapeCsvField(null)).toBe('');
      expect(escapeCsvField(undefined)).toBe('');
    });

    it('quotes anything containing a comma, a quote or a newline', () => {
      expect(escapeCsvField('Nairobi, Kenya')).toBe('"Nairobi, Kenya"');
      expect(escapeCsvField('He said "hello"')).toBe('"He said ""hello"""');
      expect(escapeCsvField('line one\nline two')).toBe('"line one\nline two"');
    });

    it('neutralises a cell that a spreadsheet would execute', () => {
      // Each of these runs on open in Excel or Sheets without the guard.
      // This one carries quotes too, so it is guarded AND quoted.
      expect(escapeCsvField('=HYPERLINK("http://evil","click")')).toBe(
        `"'=HYPERLINK(""http://evil"",""click"")"`,
      );
      expect(escapeCsvField('=1+1')).toBe("'=1+1");
      expect(escapeCsvField('+1+1')).toBe("'+1+1");
      expect(escapeCsvField('-2+3')).toBe("'-2+3");
      expect(escapeCsvField('@SUM(A1:A9)')).toBe("'@SUM(A1:A9)");
    });

    it('still quotes a neutralised cell that also needs quoting', () => {
      const result = escapeCsvField('=cmd|"/c calc"!A1');
      expect(result.startsWith(`"'=`)).toBe(true);
      expect(result.endsWith('"')).toBe(true);
    });

    it('does not mistake a negative number for a formula in a way that loses it', () => {
      // The apostrophe is added, so the value is never silently changed —
      // it is still readable as -1500.00 in the cell.
      expect(escapeCsvField('-1500.00')).toBe("'-1500.00");
    });

    it('ends every line with CRLF', () => {
      expect(csvLine(['a', 'b'])).toBe('a,b\r\n');
    });
  });

  describe('the stream', () => {
    const exporter = new CsvExporter();

    const report: ReportResult = {
      columns: [
        { key: 'tenant', label: 'Tenant' },
        { key: 'amount', label: 'Amount', format: 'money', numeric: true },
      ],
      rows: [
        { tenant: 'Grace Wanjiku', amount: '30000.00' },
        { tenant: 'Peter, Kamau', amount: '12000.50' },
      ],
      totals: { amount: '42000.50' },
      meta: { total: 2, page: 1, limit: 50 },
    };

    const meta = {
      title: 'Rent collection',
      filters: ['Period: 2026-09', 'Scope: limited to the properties assigned to you'],
      organizationName: 'ABC Properties',
      generatedAt: new Date('2026-09-11T10:00:00.000Z'),
    };

    async function read(): Promise<string> {
      const chunks: string[] = [];
      for await (const chunk of exporter.stream(report, meta)) {
        chunks.push(String(chunk));
      }
      return chunks.join('');
    }

    it('states what it covers before the data', async () => {
      const csv = await read();
      // A printed report that does not say what it filtered on cannot be
      // checked by the person holding it.
      expect(csv).toContain('# Rent collection');
      expect(csv).toContain('# ABC Properties');
      expect(csv).toContain('# Generated 2026-09-11T10:00:00.000Z');
      expect(csv).toContain('# Period: 2026-09');
      expect(csv).toContain('# Scope: limited to the properties assigned to you');
    });

    it('writes the header, the rows and a totals row', async () => {
      const lines = (await read()).split('\r\n').filter((line) => line && !line.startsWith('#'));

      expect(lines[0]).toBe('Tenant,Amount');
      expect(lines[1]).toBe('Grace Wanjiku,30000.00');
      expect(lines[2]).toBe('"Peter, Kamau",12000.50');
      expect(lines[3]).toBe('Total,42000.50');
    });

    it('puts each total under the column it totals', async () => {
      const lines = (await read()).split('\r\n').filter((line) => line && !line.startsWith('#'));
      const header = lines[0]!.split(',');
      const totals = lines[3]!.split(',');
      expect(header).toHaveLength(totals.length);
      expect(totals[header.indexOf('Amount')]).toBe('42000.50');
    });

    it('omits the totals row when a report has no totals', async () => {
      const chunks: string[] = [];
      for await (const chunk of exporter.stream({ ...report, totals: {} }, meta)) {
        chunks.push(String(chunk));
      }
      expect(chunks.join('')).not.toContain('Total,');
    });

    it('produces a header and nothing else for an empty report', async () => {
      const chunks: string[] = [];
      for await (const chunk of exporter.stream({ ...report, rows: [], totals: {} }, meta)) {
        chunks.push(String(chunk));
      }
      const lines = chunks.join('').split('\r\n').filter((line) => line && !line.startsWith('#'));
      expect(lines).toEqual(['Tenant,Amount']);
    });
  });
});

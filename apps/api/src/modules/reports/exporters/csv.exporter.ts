import type { ReportExportPayload } from '../types/report.types';
import { escapeCsvCell } from './spreadsheet-safe';
import { EXPORT_BRAND, formatExportTimestamp } from './export-brand';

/**
 * Professional UTF-8 CSV (BOM for Excel/Arabic).
 * Includes a metadata preamble, then a blank line, then the data table.
 */
export function exportCsv(payload: ReportExportPayload): Buffer {
  const generated = formatExportTimestamp(payload.generatedAt);
  const preamble = [
    [EXPORT_BRAND.name],
    [EXPORT_BRAND.system],
    [payload.title],
    [`Generated: ${generated}`],
    [`Filters: ${payload.filterSummary || 'none'}`],
    [`Records: ${payload.rows.length}`],
    [EXPORT_BRAND.confidential],
    [], // blank separator before table
  ];

  const headers = payload.columns.map((c) => c.header);
  const dataLines = [
    headers.map(escapeCsvCell).join(','),
    ...payload.rows.map((row) =>
      payload.columns.map((col) => escapeCsvCell(row[col.key])).join(','),
    ),
  ];

  const metaLines = preamble.map((cells) => cells.map(escapeCsvCell).join(','));
  const body = [...metaLines, ...dataLines].join('\r\n');
  return Buffer.from(`\uFEFF${body}`, 'utf8');
}

import type { ReportExportPayload } from '../types/report.types';
import { escapeCsvCell } from './spreadsheet-safe';

/** UTF-8 CSV with BOM for Excel Arabic compatibility. */
export function exportCsv(payload: ReportExportPayload): Buffer {
  const headers = payload.columns.map((c) => c.header);
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...payload.rows.map((row) =>
      payload.columns.map((col) => escapeCsvCell(row[col.key])).join(','),
    ),
  ];
  const body = lines.join('\r\n');
  return Buffer.from(`\uFEFF${body}`, 'utf8');
}

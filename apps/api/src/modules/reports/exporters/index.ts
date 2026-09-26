import type { ReportExportPayload, ExportFormat } from '../types/report.types';
import { exportCsv } from './csv.exporter';
import { exportExcel } from './excel.exporter';
import { exportPdf } from './pdf.exporter';

export async function renderExport(
  format: ExportFormat,
  payload: ReportExportPayload,
): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
  const stamp = payload.generatedAt.toISOString().slice(0, 10);
  const base = `${payload.reportType}-${stamp}`;

  if (format === 'csv') {
    return {
      buffer: exportCsv(payload),
      contentType: 'text/csv; charset=utf-8',
      filename: `${base}.csv`,
    };
  }
  if (format === 'xlsx') {
    return {
      buffer: await exportExcel(payload),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: `${base}.xlsx`,
    };
  }
  return {
    buffer: await exportPdf(payload),
    contentType: 'application/pdf',
    filename: `${base}.pdf`,
  };
}

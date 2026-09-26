import ExcelJS from 'exceljs';
import type { ReportExportPayload } from '../types/report.types';
import { sanitizeSpreadsheetValue } from './spreadsheet-safe';

export async function exportExcel(payload: ReportExportPayload): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Muslim Hands Inventory';
  workbook.created = payload.generatedAt;

  const sheet = workbook.addWorksheet(payload.reportType.slice(0, 31) || 'Report');
  sheet.addRow([payload.title]);
  sheet.addRow([`Generated: ${payload.generatedAt.toISOString()}`]);
  sheet.addRow([`Filters: ${payload.filterSummary || 'none'}`]);
  sheet.addRow([]);
  sheet.addRow(payload.columns.map((c) => c.header));

  const headerRow = sheet.lastRow;
  if (headerRow) {
    headerRow.font = { bold: true };
  }

  for (const row of payload.rows) {
    sheet.addRow(
      payload.columns.map((col) => sanitizeSpreadsheetValue(row[col.key])),
    );
  }

  sheet.columns.forEach((column) => {
    column.width = Math.min(40, Math.max(12, Number(column.width ?? 14)));
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

import ExcelJS from 'exceljs';
import type { ReportExportPayload } from '../types/report.types';
import { sanitizeSpreadsheetValue } from './spreadsheet-safe';

const BRAND = {
  primary: '0D7377',
  primaryDark: '095456',
  headerBg: '0D7377',
  headerFg: 'FFFFFF',
  subtitle: '475569',
  zebra: 'F0FDFA',
  border: 'CBD5E1',
};

export async function exportExcel(payload: ReportExportPayload): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Muslim Hands';
  workbook.company = 'Muslim Hands — Medicine Distribution';
  workbook.created = payload.generatedAt;
  workbook.modified = payload.generatedAt;

  const sheet = workbook.addWorksheet(payload.reportType.slice(0, 31) || 'Report', {
    views: [{ state: 'frozen', ySplit: 5 }],
    properties: { defaultRowHeight: 18 },
  });

  const colCount = Math.max(payload.columns.length, 1);

  sheet.mergeCells(1, 1, 1, colCount);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = payload.title;
  titleCell.font = { bold: true, size: 16, color: { argb: `FF${BRAND.primaryDark}` }, name: 'Calibri' };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
  sheet.getRow(1).height = 28;

  sheet.mergeCells(2, 1, 2, colCount);
  const orgCell = sheet.getCell(2, 1);
  orgCell.value = 'Muslim Hands — Medicine Distribution System';
  orgCell.font = { size: 11, color: { argb: `FF${BRAND.primary}` }, name: 'Calibri' };

  sheet.mergeCells(3, 1, 3, colCount);
  const metaCell = sheet.getCell(3, 1);
  metaCell.value = `Generated: ${payload.generatedAt.toISOString().replace('T', ' ').slice(0, 19)} UTC  ·  Filters: ${payload.filterSummary || 'none'}`;
  metaCell.font = { size: 9, color: { argb: `FF${BRAND.subtitle}` }, name: 'Calibri' };

  sheet.addRow([]);

  const headerRow = sheet.addRow(payload.columns.map((c) => c.header));
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: `FF${BRAND.headerFg}` }, name: 'Calibri', size: 10 };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: `FF${BRAND.headerBg}` },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    cell.border = {
      bottom: { style: 'thin', color: { argb: `FF${BRAND.border}` } },
    };
  });

  payload.rows.forEach((row, index) => {
    const excelRow = sheet.addRow(
      payload.columns.map((col) => sanitizeSpreadsheetValue(row[col.key])),
    );
    excelRow.eachCell((cell) => {
      cell.font = { name: 'Calibri', size: 9 };
      cell.alignment = { vertical: 'middle', wrapText: true };
      if (index % 2 === 1) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: `FF${BRAND.zebra}` },
        };
      }
      cell.border = {
        bottom: { style: 'hair', color: { argb: `FF${BRAND.border}` } },
      };
    });
  });

  sheet.columns.forEach((column, index) => {
    const header = payload.columns[index]?.header ?? '';
    const sample = payload.rows.slice(0, 30).map((row) => String(row[payload.columns[index]?.key ?? ''] ?? ''));
    const maxLen = Math.max(header.length, ...sample.map((v) => v.length), 10);
    column.width = Math.min(42, Math.max(12, maxLen + 2));
  });

  if (payload.rows.length > 0) {
    sheet.autoFilter = {
      from: { row: 5, column: 1 },
      to: { row: 5 + payload.rows.length, column: colCount },
    };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

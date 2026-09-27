import ExcelJS from 'exceljs';
import type { ReportExportPayload } from '../types/report.types';
import { sanitizeSpreadsheetValue } from './spreadsheet-safe';
import { EXPORT_BRAND, formatExportTimestamp } from './export-brand';

const B = EXPORT_BRAND.excel;

export async function exportExcel(payload: ReportExportPayload): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = EXPORT_BRAND.name;
  workbook.lastModifiedBy = EXPORT_BRAND.name;
  workbook.company = EXPORT_BRAND.tagline;
  workbook.created = payload.generatedAt;
  workbook.modified = payload.generatedAt;
  workbook.description = payload.title;

  const sheetName = payload.reportType.slice(0, 31) || 'Report';
  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ state: 'frozen', ySplit: 6, showGridLines: false }],
    properties: { defaultRowHeight: 18, tabColor: { argb: `FF${B.primary}` } },
    pageSetup: {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      paperSize: 9, // A4
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
    headerFooter: {
      oddHeader: `&L${EXPORT_BRAND.tagline}&R${payload.title}`,
      oddFooter: `&L${EXPORT_BRAND.confidential}&CPage &P of &N&R${formatExportTimestamp(payload.generatedAt)}`,
    },
  });

  const colCount = Math.max(payload.columns.length, 1);

  // Accent bar
  sheet.mergeCells(1, 1, 1, colCount);
  const bar = sheet.getCell(1, 1);
  bar.value = EXPORT_BRAND.tagline.toUpperCase();
  bar.font = { bold: true, size: 9, color: { argb: `FF${B.white}` }, name: 'Calibri' };
  bar.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${B.primary}` } };
  bar.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  sheet.getRow(1).height = 20;

  // Title
  sheet.mergeCells(2, 1, 2, colCount);
  const titleCell = sheet.getCell(2, 1);
  titleCell.value = payload.title;
  titleCell.font = { bold: true, size: 18, color: { argb: `FF${B.primaryDark}` }, name: 'Calibri' };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  sheet.getRow(2).height = 30;

  // Meta strip
  sheet.mergeCells(3, 1, 3, colCount);
  const metaCell = sheet.getCell(3, 1);
  metaCell.value = `Generated ${formatExportTimestamp(payload.generatedAt)}  ·  ${payload.rows.length} record(s)  ·  Filters: ${payload.filterSummary || 'none'}`;
  metaCell.font = { size: 9, color: { argb: `FF${B.muted}` }, name: 'Calibri' };
  metaCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${B.metaBg}` } };
  metaCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  sheet.getRow(3).height = 20;

  // Confidential note
  sheet.mergeCells(4, 1, 4, colCount);
  const confCell = sheet.getCell(4, 1);
  confCell.value = EXPORT_BRAND.confidential;
  confCell.font = { italic: true, size: 8, color: { argb: `FF${B.muted}` }, name: 'Calibri' };
  confCell.alignment = { indent: 1 };
  sheet.getRow(4).height = 16;

  sheet.addRow([]); // row 5 spacer

  const headerRowNumber = 6;
  const headerRow = sheet.addRow(payload.columns.map((c) => c.header));
  headerRow.height = 24;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: `FF${B.white}` }, name: 'Calibri', size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${B.headerBg}` } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
    cell.border = {
      top: { style: 'thin', color: { argb: `FF${B.primaryDark}` } },
      bottom: { style: 'medium', color: { argb: `FF${B.accent}` } },
      left: { style: 'hair', color: { argb: `FF${B.border}` } },
      right: { style: 'hair', color: { argb: `FF${B.border}` } },
    };
  });

  payload.rows.forEach((row, index) => {
    const excelRow = sheet.addRow(
      payload.columns.map((col) => sanitizeSpreadsheetValue(row[col.key])),
    );
    excelRow.height = 18;
    excelRow.eachCell((cell) => {
      cell.font = { name: 'Calibri', size: 9, color: { argb: `FF${B.text}` } };
      cell.alignment = { vertical: 'middle', wrapText: true, indent: 1 };
      if (index % 2 === 1) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: `FF${B.zebra}` },
        };
      }
      cell.border = {
        bottom: { style: 'hair', color: { argb: `FF${B.border}` } },
        left: { style: 'hair', color: { argb: `FF${B.border}` } },
        right: { style: 'hair', color: { argb: `FF${B.border}` } },
      };
    });
  });

  // Summary footer row
  const footerRow = sheet.addRow([]);
  sheet.mergeCells(footerRow.number, 1, footerRow.number, colCount);
  const footerCell = sheet.getCell(footerRow.number, 1);
  footerCell.value = `End of report · ${payload.rows.length} row(s) · ${EXPORT_BRAND.name}`;
  footerCell.font = { size: 8, italic: true, color: { argb: `FF${B.muted}` }, name: 'Calibri' };
  footerCell.alignment = { horizontal: 'center', vertical: 'middle' };
  footerRow.height = 20;

  sheet.columns.forEach((column, index) => {
    const header = payload.columns[index]?.header ?? '';
    const sample = payload.rows
      .slice(0, 40)
      .map((row) => String(row[payload.columns[index]?.key ?? ''] ?? ''));
    const maxLen = Math.max(header.length, ...sample.map((v) => Math.min(v.length, 48)), 10);
    column.width = Math.min(40, Math.max(12, maxLen + 3));
  });

  if (payload.rows.length > 0) {
    sheet.autoFilter = {
      from: { row: headerRowNumber, column: 1 },
      to: { row: headerRowNumber + payload.rows.length, column: colCount },
    };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

import PDFDocument from 'pdfkit';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ReportExportPayload } from '../types/report.types';
import { EXPORT_BRAND, formatExportDate, formatExportTimestamp } from './export-brand';

function resolveArabicFont(): string | null {
  const candidates = [
    path.join(__dirname, '..', '..', '..', '..', 'assets', 'fonts', 'NotoSansArabic-Regular.ttf'),
    path.join(process.cwd(), 'assets', 'fonts', 'NotoSansArabic-Regular.ttf'),
    path.join(process.cwd(), 'apps', 'api', 'assets', 'fonts', 'NotoSansArabic-Regular.ttf'),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function cellText(value: unknown): string {
  if (value == null || value === '') return '—';
  if (value instanceof Date) return value.toISOString().replace('T', ' ').slice(0, 19);
  return String(value);
}

/** Weight columns by header + sample content so wide fields get more space. */
function columnWidths(payload: ReportExportPayload, usableWidth: number): number[] {
  const weights = payload.columns.map((col) => {
    const samples = payload.rows.slice(0, 25).map((row) => cellText(row[col.key]).length);
    const content = Math.max(col.header.length, ...samples, 6);
    return Math.min(Math.max(content, 8), 36);
  });
  const total = weights.reduce((sum, w) => sum + w, 0) || 1;
  return weights.map((w) => (w / total) * usableWidth);
}

/** Professional branded landscape PDF for catalog and operational reports. */
export async function exportPdf(payload: ReportExportPayload): Promise<Buffer> {
  const fontPath = resolveArabicFont();

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 32,
      size: 'A4',
      layout: 'landscape',
      bufferPages: true,
      info: {
        Title: payload.title,
        Author: EXPORT_BRAND.tagline,
        Subject: payload.reportType,
        Creator: EXPORT_BRAND.system,
        Keywords: `muslim-hands,${payload.reportType},export`,
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const fontRegular = fontPath ? 'ReportFont' : 'Helvetica';
    const fontBold = fontPath ? 'ReportFont' : 'Helvetica-Bold';
    if (fontPath) {
      doc.registerFont('ReportFont', fontPath);
      doc.font('ReportFont');
    } else {
      doc.font('Helvetica');
    }

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const marginLeft = doc.page.margins.left;
    const marginRight = doc.page.margins.right;
    const usableWidth = pageWidth - marginLeft - marginRight;
    const startX = marginLeft;
    const widths = columnWidths(payload, usableWidth);
    const bottomLimit = pageHeight - 36;

    const drawPageChrome = () => {
      // Top brand bar
      doc.save();
      doc.rect(0, 0, pageWidth, 48).fill(EXPORT_BRAND.primary);
      doc.rect(0, 48, pageWidth, 3).fill(EXPORT_BRAND.accent);
      doc.restore();

      doc.fillColor(EXPORT_BRAND.white).fontSize(8).font(fontBold);
      doc.text(EXPORT_BRAND.name.toUpperCase(), startX, 10, { width: usableWidth * 0.55 });

      doc.fontSize(11).font(fontBold);
      doc.text(payload.title, startX, 22, { width: usableWidth * 0.7, lineBreak: false });

      doc.fontSize(8).font(fontRegular).fillColor('#D1FAE5');
      doc.text(formatExportDate(payload.generatedAt), startX + usableWidth * 0.72, 14, {
        width: usableWidth * 0.28,
        align: 'right',
      });
      doc.text(`${payload.rows.length} records`, startX + usableWidth * 0.72, 28, {
        width: usableWidth * 0.28,
        align: 'right',
      });

      // Meta strip
      doc.y = 58;
      doc.save();
      doc.rect(startX, 56, usableWidth, 18).fill(EXPORT_BRAND.primarySoft);
      doc.restore();
      doc.fillColor(EXPORT_BRAND.muted).fontSize(7.5).font(fontRegular);
      doc.text(
        `${EXPORT_BRAND.system}  ·  Generated ${formatExportTimestamp(payload.generatedAt)}  ·  Filters: ${payload.filterSummary || 'none'}`,
        startX + 6,
        61,
        { width: usableWidth - 12, lineBreak: false },
      );
      doc.y = 82;
      doc.fillColor(EXPORT_BRAND.text);
    };

    const drawTableHeader = () => {
      const y = doc.y;
      const headerHeight = 16;
      doc.save();
      doc.rect(startX, y, usableWidth, headerHeight).fill(EXPORT_BRAND.primary);
      doc.restore();

      let x = startX;
      doc.fillColor(EXPORT_BRAND.white).fontSize(7).font(fontBold);
      payload.columns.forEach((col, index) => {
        doc.text(col.header, x + 3, y + 4, {
          width: widths[index]! - 6,
          lineBreak: false,
          ellipsis: true,
        });
        x += widths[index]!;
      });
      doc.y = y + headerHeight + 2;
      doc.fillColor(EXPORT_BRAND.text).font(fontRegular);
    };

    drawPageChrome();
    drawTableHeader();

    const rows = payload.rows.length
      ? payload.rows
      : [Object.fromEntries(payload.columns.map((c) => [c.key, '—']))];

    rows.forEach((row, index) => {
      // Measure row height first
      let maxHeight = 12;
      payload.columns.forEach((col, colIndex) => {
        const text = cellText(row[col.key]);
        const height = doc.heightOfString(text, { width: widths[colIndex]! - 6 });
        maxHeight = Math.max(maxHeight, Math.min(height, 42));
      });
      const rowHeight = maxHeight + 6;

      if (doc.y + rowHeight > bottomLimit) {
        doc.addPage();
        if (fontPath) doc.font('ReportFont');
        drawPageChrome();
        drawTableHeader();
      }

      const y = doc.y;
      if (index % 2 === 1) {
        doc.save();
        doc.rect(startX, y, usableWidth, rowHeight).fill(EXPORT_BRAND.primarySoft);
        doc.restore();
      }

      // subtle bottom rule
      doc
        .moveTo(startX, y + rowHeight)
        .lineTo(startX + usableWidth, y + rowHeight)
        .strokeColor(EXPORT_BRAND.border)
        .lineWidth(0.4)
        .stroke();

      let x = startX;
      doc.fillColor(EXPORT_BRAND.text).fontSize(6.5).font(fontRegular);
      payload.columns.forEach((col, colIndex) => {
        doc.text(cellText(row[col.key]), x + 3, y + 3, {
          width: widths[colIndex]! - 6,
          height: rowHeight - 4,
          ellipsis: true,
        });
        x += widths[colIndex]!;
      });
      doc.y = y + rowHeight;
    });

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      // Footer bar
      doc.save();
      doc.rect(0, pageHeight - 22, pageWidth, 22).fill('#F8FAFC');
      doc.restore();
      doc
        .fontSize(7)
        .fillColor(EXPORT_BRAND.muted)
        .font(fontRegular)
        .text(EXPORT_BRAND.confidential, 32, pageHeight - 15, {
          width: usableWidth * 0.45,
          align: 'left',
          lineBreak: false,
        })
        .text(
          `Page ${i - range.start + 1} of ${range.count}`,
          32 + usableWidth * 0.45,
          pageHeight - 15,
          { width: usableWidth * 0.2, align: 'center', lineBreak: false },
        )
        .text(payload.reportType, 32 + usableWidth * 0.65, pageHeight - 15, {
          width: usableWidth * 0.35,
          align: 'right',
          lineBreak: false,
        });
    }

    doc.end();
  });
}

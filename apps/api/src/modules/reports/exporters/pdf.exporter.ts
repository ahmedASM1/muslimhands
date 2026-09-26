import PDFDocument from 'pdfkit';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ReportExportPayload } from '../types/report.types';

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
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().replace('T', ' ').slice(0, 19);
  return String(value);
}

/** Operational PDF. Uses Noto Sans Arabic when available for Arabic text. */
export async function exportPdf(payload: ReportExportPayload): Promise<Buffer> {
  const fontPath = resolveArabicFont();

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 40,
      size: 'A4',
      layout: 'landscape',
      info: { Title: payload.title, Author: 'Muslim Hands Inventory' },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    if (fontPath) {
      doc.registerFont('ReportFont', fontPath);
      doc.font('ReportFont');
    } else {
      doc.font('Helvetica');
    }

    doc.fontSize(14).text(payload.title, { align: 'left' });
    doc.moveDown(0.3);
    doc.fontSize(9).fillColor('#444');
    doc.text(`Generated: ${payload.generatedAt.toISOString()}`);
    doc.text(`Filters: ${payload.filterSummary || 'none'}`);
    doc.moveDown(0.6);
    doc.fillColor('#000');

    const colCount = Math.max(payload.columns.length, 1);
    const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colWidth = usableWidth / colCount;
    const startX = doc.page.margins.left;

    const drawHeader = () => {
      let x = startX;
      const y = doc.y;
      doc.fontSize(8).fillColor('#111');
      for (const col of payload.columns) {
        doc.text(col.header, x, y, { width: colWidth - 4, continued: false });
        x += colWidth;
      }
      doc.moveDown(1.2);
      doc
        .moveTo(startX, doc.y)
        .lineTo(startX + usableWidth, doc.y)
        .strokeColor('#ccc')
        .stroke();
      doc.moveDown(0.4);
    };

    drawHeader();

    const rows = payload.rows.length
      ? payload.rows
      : [Object.fromEntries(payload.columns.map((c) => [c.key, '—']))];

    for (const row of rows) {
      if (doc.y > doc.page.height - 60) {
        doc.addPage();
        if (fontPath) doc.font('ReportFont');
        drawHeader();
      }
      let x = startX;
      const y = doc.y;
      let maxHeight = 12;
      for (const col of payload.columns) {
        const height = doc.heightOfString(cellText(row[col.key]), {
          width: colWidth - 4,
        });
        maxHeight = Math.max(maxHeight, height);
        doc.fontSize(7).fillColor('#222').text(cellText(row[col.key]), x, y, {
          width: colWidth - 4,
        });
        x += colWidth;
      }
      doc.y = y + maxHeight + 4;
    }

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      doc
        .fontSize(8)
        .fillColor('#666')
        .text(
          `Page ${i - range.start + 1} of ${range.count}`,
          40,
          doc.page.height - 30,
          { align: 'center', width: doc.page.width - 80 },
        );
    }

    doc.end();
  });
}

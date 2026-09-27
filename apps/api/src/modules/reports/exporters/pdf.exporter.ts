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

/** Professional landscape PDF with brand header and tabular layout. */
export async function exportPdf(payload: ReportExportPayload): Promise<Buffer> {
  const fontPath = resolveArabicFont();

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 36,
      size: 'A4',
      layout: 'landscape',
      info: {
        Title: payload.title,
        Author: 'Muslim Hands — Medicine Distribution',
        Subject: payload.reportType,
        Creator: 'Muslim Hands Inventory',
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const font = fontPath ? 'ReportFont' : 'Helvetica';
    if (fontPath) {
      doc.registerFont('ReportFont', fontPath);
      doc.font('ReportFont');
    } else {
      doc.font('Helvetica');
    }

    const pageWidth = doc.page.width;
    const usableWidth = pageWidth - doc.page.margins.left - doc.page.margins.right;
    const startX = doc.page.margins.left;

    const drawBrandHeader = () => {
      doc.save();
      doc.rect(0, 0, pageWidth, 52).fill('#0D7377');
      doc.fillColor('#FFFFFF').fontSize(14).font(font);
      doc.text(payload.title, startX, 14, { width: usableWidth - 120, continued: false });
      doc.fontSize(8).fillColor('#D1FAE5');
      doc.text('Muslim Hands — Medicine Distribution System', startX, 34, {
        width: usableWidth - 120,
      });
      doc.fontSize(8).fillColor('#ECFDF5');
      doc.text(payload.generatedAt.toISOString().slice(0, 10), startX + usableWidth - 90, 20, {
        width: 90,
        align: 'right',
      });
      doc.restore();
      doc.y = 64;
      doc.fillColor('#475569').fontSize(8).font(font);
      doc.text(`Filters: ${payload.filterSummary || 'none'}`, startX, doc.y, {
        width: usableWidth,
      });
      doc.moveDown(0.6);
      doc.fillColor('#000000');
    };

    const colCount = Math.max(payload.columns.length, 1);
    const colWidth = usableWidth / colCount;

    const drawHeader = () => {
      const y = doc.y;
      doc.save();
      doc.rect(startX, y - 2, usableWidth, 18).fill('#0D7377');
      doc.restore();
      let x = startX;
      doc.fontSize(7).fillColor('#FFFFFF').font(font);
      for (const col of payload.columns) {
        doc.text(col.header, x + 2, y + 2, { width: colWidth - 4, continued: false });
        x += colWidth;
      }
      doc.y = y + 20;
      doc.fillColor('#000000');
    };

    drawBrandHeader();
    drawHeader();

    const rows = payload.rows.length
      ? payload.rows
      : [Object.fromEntries(payload.columns.map((c) => [c.key, '—']))];

    rows.forEach((row, index) => {
      if (doc.y > doc.page.height - 50) {
        doc.addPage();
        if (fontPath) doc.font('ReportFont');
        drawBrandHeader();
        drawHeader();
      }
      let x = startX;
      const y = doc.y;
      let maxHeight = 11;
      if (index % 2 === 1) {
        doc.save();
        doc.rect(startX, y - 1, usableWidth, 14).fill('#F0FDFA');
        doc.restore();
      }
      for (const col of payload.columns) {
        const text = cellText(row[col.key]);
        const height = doc.heightOfString(text, { width: colWidth - 4 });
        maxHeight = Math.max(maxHeight, height);
        doc.fontSize(6.5).fillColor('#1E293B').font(font).text(text, x + 2, y, {
          width: colWidth - 4,
        });
        x += colWidth;
      }
      doc.y = y + maxHeight + 3;
    });

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      doc
        .fontSize(7)
        .fillColor('#64748B')
        .font(font)
        .text(
          `Confidential · Page ${i - range.start + 1} of ${range.count} · ${payload.reportType}`,
          36,
          doc.page.height - 24,
          { align: 'center', width: doc.page.width - 72 },
        );
    }

    doc.end();
  });
}

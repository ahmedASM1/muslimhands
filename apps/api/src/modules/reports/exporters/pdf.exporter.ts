import PDFDocument from 'pdfkit';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ArabicShaper } from 'arabic-persian-reshaper';
import bidiFactory from 'bidi-js';
import type { ReportExportPayload } from '../types/report.types';
import { EXPORT_BRAND, formatExportDate, formatExportTimestamp } from './export-brand';

const ARABIC_CHAR = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const LATIN_LETTER = /[A-Za-z]/;
/** Phones / IDs / codes that must stay left-to-right in PDF cells. */
const LTR_TECHNICAL = /^[\s]*[+]?[\d\s\-()./#]+[\s]*$/;
const bidi = bidiFactory();

function resolveAsset(...parts: string[]): string | null {
  const candidates = [
    path.join(__dirname, '..', '..', '..', '..', 'assets', ...parts),
    path.join(process.cwd(), 'assets', ...parts),
    path.join(process.cwd(), 'apps', 'api', 'assets', ...parts),
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

/**
 * PDFKit draws left-to-right and does not shape Arabic. Convert logical Arabic
 * to visual order with connected glyphs so names render correctly.
 */
function prepareTextForPdf(text: string): string {
  if (!text || text === '—') return text;
  if (LTR_TECHNICAL.test(text) || !ARABIC_CHAR.test(text)) {
    // Keep phones/IDs as strict LTR even inside RTL locales.
    if (/^\+?\d/.test(text.trim()) || LTR_TECHNICAL.test(text)) {
      return `\u202A${text}\u202C`;
    }
    return text;
  }

  try {
    const reshaped = ArabicShaper.convertArabic(text);
    const levels = bidi.getEmbeddingLevels(reshaped);
    return bidi.getReorderedString(reshaped, levels);
  } catch {
    return text;
  }
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

type FontPair = { latin: string; arabic: string | null };

function splitScriptRuns(text: string): Array<{ text: string; arabic: boolean }> {
  const runs: Array<{ text: string; arabic: boolean }> = [];
  let buf = '';
  let arabic: boolean | null = null;

  for (const ch of text) {
    const isArabic = ARABIC_CHAR.test(ch);
    const isLatin = LATIN_LETTER.test(ch);
    const next: boolean | null = isArabic ? true : isLatin ? false : arabic;

    if (arabic === null) {
      arabic = isArabic;
      buf = ch;
      continue;
    }

    if (next === null || next === arabic) {
      buf += ch;
      continue;
    }

    runs.push({ text: buf, arabic });
    buf = ch;
    arabic = next;
  }

  if (buf) runs.push({ text: buf, arabic: arabic ?? false });
  return runs.length ? runs : [{ text, arabic: false }];
}

function drawText(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  fonts: FontPair,
  options: {
    width: number;
    height?: number;
    align?: 'left' | 'center' | 'right';
    lineBreak?: boolean;
    ellipsis?: boolean;
  },
) {
  const prepared = prepareTextForPdf(text);
  const hasArabic = Boolean(fonts.arabic && ARABIC_CHAR.test(prepared));
  if (!hasArabic || !fonts.arabic) {
    doc.font(fonts.latin);
    doc.text(prepared, x, y, {
      width: options.width,
      height: options.height,
      align: options.align,
      lineBreak: options.lineBreak ?? false,
      ellipsis: options.ellipsis,
    });
    return;
  }

  const runs = splitScriptRuns(prepared);
  const hasLatinLetters = runs.some((run) => !run.arabic && LATIN_LETTER.test(run.text));

  // Pure Arabic (plus digits/punctuation): one font after reshape+bidi.
  if (!hasLatinLetters) {
    doc.font(fonts.arabic);
    doc.text(prepared, x, y, {
      width: options.width,
      height: options.height,
      align: options.align,
      lineBreak: options.lineBreak ?? false,
      ellipsis: options.ellipsis,
    });
    return;
  }

  // Mixed scripts: switch fonts per run so Latin is not drawn with Arabic-only glyphs.
  runs.forEach((run, index) => {
    const last = index === runs.length - 1;
    doc.font(run.arabic ? fonts.arabic! : fonts.latin);
    if (index === 0) {
      doc.text(run.text, x, y, {
        width: options.width,
        height: options.height,
        align: options.align,
        lineBreak: false,
        continued: !last,
      });
    } else {
      doc.text(run.text, { lineBreak: false, continued: !last });
    }
  });
}

/** Professional branded landscape PDF for catalog and operational reports. */
export async function exportPdf(payload: ReportExportPayload): Promise<Buffer> {
  const arabicFontPath = resolveAsset('fonts', 'NotoSansArabic-Regular.ttf');
  const logoPath = resolveAsset('brand', 'muslimhands-logo.png');

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

    // Helvetica for Latin (Noto Sans Arabic has no Latin letters — that caused □□□ boxes).
    const fonts: FontPair = {
      latin: 'Helvetica',
      arabic: arabicFontPath ? 'ReportArabic' : null,
    };
    if (arabicFontPath) {
      doc.registerFont('ReportArabic', arabicFontPath);
    }
    doc.font(fonts.latin);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const marginLeft = doc.page.margins.left;
    const marginRight = doc.page.margins.right;
    const usableWidth = pageWidth - marginLeft - marginRight;
    const startX = marginLeft;
    const widths = columnWidths(payload, usableWidth);
    const bottomLimit = pageHeight - 36;
    const headerHeight = logoPath ? 56 : 48;
    const logoSize = 40;

    const drawPageChrome = () => {
      doc.save();
      doc.rect(0, 0, pageWidth, headerHeight).fill(EXPORT_BRAND.primary);
      doc.rect(0, headerHeight, pageWidth, 3).fill(EXPORT_BRAND.accent);
      doc.restore();

      let textX = startX;
      if (logoPath) {
        try {
          doc.image(logoPath, startX, 8, {
            width: logoSize,
            height: logoSize,
            fit: [logoSize, logoSize],
          });
          textX = startX + logoSize + 10;
        } catch {
          // Logo optional — continue without it if image decode fails.
        }
      }

      const titleWidth = usableWidth * 0.62 - (textX - startX);
      doc.fillColor(EXPORT_BRAND.white).fontSize(8);
      drawText(doc, EXPORT_BRAND.name.toUpperCase(), textX, 10, fonts, {
        width: titleWidth,
        lineBreak: false,
      });

      doc.fontSize(11);
      drawText(doc, payload.title, textX, 24, fonts, {
        width: titleWidth,
        lineBreak: false,
      });

      doc.fontSize(8).fillColor('#D1FAE5');
      drawText(doc, formatExportDate(payload.generatedAt), startX + usableWidth * 0.72, 14, fonts, {
        width: usableWidth * 0.28,
        align: 'right',
        lineBreak: false,
      });
      drawText(doc, `${payload.rows.length} records`, startX + usableWidth * 0.72, 28, fonts, {
        width: usableWidth * 0.28,
        align: 'right',
        lineBreak: false,
      });

      const metaY = headerHeight + 8;
      doc.save();
      doc.rect(startX, metaY, usableWidth, 18).fill(EXPORT_BRAND.primarySoft);
      doc.restore();
      doc.fillColor(EXPORT_BRAND.muted).fontSize(7.5);
      drawText(
        doc,
        `${EXPORT_BRAND.system}  ·  Generated ${formatExportTimestamp(payload.generatedAt)}  ·  Filters: ${payload.filterSummary || 'none'}`,
        startX + 6,
        metaY + 5,
        fonts,
        { width: usableWidth - 12, lineBreak: false },
      );
      doc.y = metaY + 26;
      doc.fillColor(EXPORT_BRAND.text);
    };

    const drawTableHeader = () => {
      const y = doc.y;
      const rowH = 16;
      doc.save();
      doc.rect(startX, y, usableWidth, rowH).fill(EXPORT_BRAND.primary);
      doc.restore();

      let x = startX;
      doc.fillColor(EXPORT_BRAND.white).fontSize(7);
      payload.columns.forEach((col, index) => {
        drawText(doc, col.header, x + 3, y + 4, fonts, {
          width: widths[index]! - 6,
          lineBreak: false,
          ellipsis: true,
        });
        x += widths[index]!;
      });
      doc.y = y + rowH + 2;
      doc.fillColor(EXPORT_BRAND.text);
    };

    drawPageChrome();
    drawTableHeader();

    const rows = payload.rows.length
      ? payload.rows
      : [Object.fromEntries(payload.columns.map((c) => [c.key, '—']))];

    rows.forEach((row, index) => {
      let maxHeight = 12;
      payload.columns.forEach((col, colIndex) => {
        const text = prepareTextForPdf(cellText(row[col.key]));
        const fontName =
          fonts.arabic && ARABIC_CHAR.test(text) ? fonts.arabic : fonts.latin;
        doc.font(fontName).fontSize(6.5);
        const height = doc.heightOfString(text, { width: widths[colIndex]! - 6 });
        maxHeight = Math.max(maxHeight, Math.min(height, 42));
      });
      const rowHeight = maxHeight + 6;

      if (doc.y + rowHeight > bottomLimit) {
        doc.addPage();
        doc.font(fonts.latin);
        drawPageChrome();
        drawTableHeader();
      }

      const y = doc.y;
      if (index % 2 === 1) {
        doc.save();
        doc.rect(startX, y, usableWidth, rowHeight).fill(EXPORT_BRAND.primarySoft);
        doc.restore();
      }

      doc
        .moveTo(startX, y + rowHeight)
        .lineTo(startX + usableWidth, y + rowHeight)
        .strokeColor(EXPORT_BRAND.border)
        .lineWidth(0.4)
        .stroke();

      let x = startX;
      doc.fillColor(EXPORT_BRAND.text).fontSize(6.5);
      payload.columns.forEach((col, colIndex) => {
        drawText(doc, cellText(row[col.key]), x + 3, y + 3, fonts, {
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
      doc.save();
      doc.rect(0, pageHeight - 22, pageWidth, 22).fill('#F8FAFC');
      doc.restore();
      doc.fontSize(7).fillColor(EXPORT_BRAND.muted);
      drawText(doc, EXPORT_BRAND.confidential, 32, pageHeight - 15, fonts, {
        width: usableWidth * 0.45,
        align: 'left',
        lineBreak: false,
      });
      drawText(
        doc,
        `Page ${i - range.start + 1} of ${range.count}`,
        32 + usableWidth * 0.45,
        pageHeight - 15,
        fonts,
        { width: usableWidth * 0.2, align: 'center', lineBreak: false },
      );
      drawText(doc, payload.reportType, 32 + usableWidth * 0.65, pageHeight - 15, fonts, {
        width: usableWidth * 0.35,
        align: 'right',
        lineBreak: false,
      });
    }

    doc.end();
  });
}

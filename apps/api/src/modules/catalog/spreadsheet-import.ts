import ExcelJS from 'exceljs';

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function parseCsv(content: string): Record<string, string>[] {
  const lines = content
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]!).map(normalizeHeader);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (!header) return;
      row[header] = cells[index] ?? '';
    });
    return row;
  });
}

async function parseXlsx(buffer: Buffer): Promise<Record<string, string>[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const rows: Record<string, string>[] = [];
  let headers: string[] = [];

  sheet.eachRow((row, rowNumber) => {
    const values = (row.values as unknown[])
      .slice(1)
      .map((value) => (value == null ? '' : String(typeof value === 'object' && 'text' in (value as object) ? (value as { text: string }).text : value).trim()));

    if (rowNumber === 1) {
      headers = values.map(normalizeHeader);
      return;
    }

    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (!header) return;
      record[header] = values[index] ?? '';
    });
    if (Object.values(record).some((value) => value.trim())) {
      rows.push(record);
    }
  });

  return rows;
}

export async function parseSpreadsheetRows(
  buffer: Buffer,
  filename: string,
): Promise<Record<string, string>[]> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    return parseCsv(buffer.toString('utf8'));
  }
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    return parseXlsx(buffer);
  }
  throw new Error('Unsupported file type. Upload a .csv or .xlsx file.');
}

export function pickField(row: Record<string, string>, ...aliases: string[]): string {
  for (const alias of aliases) {
    const key = normalizeHeader(alias);
    const direct = row[key];
    if (direct?.trim()) return direct.trim();
  }
  return '';
}

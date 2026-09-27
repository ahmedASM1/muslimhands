import ExcelJS from 'exceljs';
import { CATALOG_ITEM_TYPE, normalizeCatalogItemType } from '@mh/shared';

export function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-./]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/** Canonical field keys used across stock / catalog spreadsheets. */
const HEADER_ALIASES: Record<string, string[]> = {
  name: [
    'name',
    'medicine',
    'medicine_name',
    'product',
    'product_name',
    'item',
    'item_name',
    'item_description',
    'description',
    'drug',
    'drug_name',
    'supply',
    'supply_name',
    'الاسم',
    'اسم_الدواء',
    'اسم_المستلزم',
    'الوصف',
    'وصف_الصنف',
  ],
  unit: ['unit', 'unit_code', 'unit_name', 'uom', 'الوحدة', 'وحدة'],
  category: ['category', 'category_name', 'التصنيف', 'الفئة', 'الصنف', 'group'],
  item_type: [
    'item_type',
    'itemtype',
    'type',
    'catalog_type',
    'product_type',
    'النوع',
    'نوع_الصنف',
  ],
  dosage_form: ['dosage_form', 'dosageform', 'form', 'الشكل', 'الشكل_الصيدلاني'],
  strength: ['strength', 'concentration', 'التركيز'],
  sku: ['sku', 'code', 'الرمز'],
  barcode: ['barcode', 'الباركود'],
  generic_name: ['generic_name', 'generic', 'الاسم_العلمي'],
  brand_name: ['brand_name', 'brand', 'الاسم_التجاري'],
  description: ['notes', 'note', 'details', 'full_description', 'الوصف', 'ملاحظات'],
};

const HEADER_HINT_SET = new Set(
  Object.values(HEADER_ALIASES)
    .flat()
    .map((alias) => normalizeHeader(alias)),
);

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

function cellToString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object' && value !== null && 'text' in value) {
    return String((value as { text: string }).text ?? '').trim();
  }
  if (typeof value === 'object' && value !== null && 'result' in value) {
    const result = (value as { result?: unknown }).result;
    return result == null ? '' : String(result).trim();
  }
  return String(value).trim();
}

function scoreHeaderRow(cells: string[]): number {
  let score = 0;
  const seen = new Set<string>();
  for (const cell of cells) {
    const key = normalizeHeader(cell);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (HEADER_HINT_SET.has(key)) score += 3;
    if (key.includes('item') && key.includes('description')) score += 4;
    if (key === 'unit' || key === 'uom') score += 3;
    if (key.includes('dispensed') || key.includes('supplied') || key.includes('remaining')) score += 1;
    if (key.includes('stock') || key.includes('qty') || key.includes('quantity')) score += 1;
  }
  return score;
}

function findHeaderRowIndex(matrix: string[][]): number {
  let bestIndex = 0;
  let bestScore = -1;
  const limit = Math.min(matrix.length, 40);
  for (let i = 0; i < limit; i += 1) {
    const score = scoreHeaderRow(matrix[i] ?? []);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  // Prefer an explicit item/name/unit header; otherwise fall back to first non-empty row.
  if (bestScore >= 3) return bestIndex;
  const firstNonEmpty = matrix.findIndex((row) => row.some((cell) => cell.trim()));
  return firstNonEmpty >= 0 ? firstNonEmpty : 0;
}

function canonicalizeHeader(raw: string): string {
  const key = normalizeHeader(raw);
  if (!key) return '';
  for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.some((alias) => normalizeHeader(alias) === key)) {
      return canonical;
    }
  }
  // Fuzzy: "Item Description" / "وصف الصنف"
  if (key.includes('item') && key.includes('description')) return 'name';
  if (key === 'desc' || key === 'itemdesc') return 'name';
  return key;
}

function inferItemTypeFromSheetName(sheetName: string): string | undefined {
  const lower = sheetName.toLowerCase();
  if (
    lower.includes('medical supply') ||
    lower.includes('medical_supply') ||
    lower.includes('supplies') ||
    lower.includes('مستلزم')
  ) {
    return CATALOG_ITEM_TYPE.MEDICAL_SUPPLY;
  }
  if (
    lower.includes('medicine') ||
    lower.includes('drug') ||
    lower.includes('pharma') ||
    lower.includes('دواء') ||
    lower.includes('أدوية') ||
    lower.includes('ادوية')
  ) {
    return CATALOG_ITEM_TYPE.MEDICINE;
  }
  return undefined;
}

function isDataRow(record: Record<string, string>): boolean {
  const name = (record.name || record.item_description || record.description || '').trim();
  if (!name) return false;
  // Skip totals / blank serial noise
  const lower = name.toLowerCase();
  if (lower === 'total' || lower === 'grand total' || lower.startsWith('page ')) return false;
  // Skip rows that are only a serial number in name
  if (/^\d+$/.test(name)) return false;
  return Object.values(record).some((value) => value.trim().length > 0);
}

function rowsFromMatrix(
  matrix: string[][],
  meta?: { sheetName?: string; itemTypeHint?: string },
): Record<string, string>[] {
  if (!matrix.length) return [];
  const headerIndex = findHeaderRowIndex(matrix);
  const headerCells = matrix[headerIndex] ?? [];
  const headers = headerCells.map((cell) => canonicalizeHeader(cell));

  const rows: Record<string, string>[] = [];
  for (let r = headerIndex + 1; r < matrix.length; r += 1) {
    const cells = matrix[r] ?? [];
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (!header) return;
      // Prefer first occurrence of a canonical header; keep extras under original key if needed
      if (record[header] && !record[header].trim()) {
        record[header] = cells[index] ?? '';
      } else if (!record[header]) {
        record[header] = cells[index] ?? '';
      }
    });

    if (meta?.sheetName) record._sheet = meta.sheetName;
    if (meta?.itemTypeHint) {
      record._item_type_hint = meta.itemTypeHint;
      if (!record.item_type?.trim()) record.item_type = meta.itemTypeHint;
    }
    record._source_row = String(r + 1);

    if (isDataRow(record)) {
      rows.push(record);
    }
  }
  return rows;
}

function parseCsvMatrix(content: string): string[][] {
  return content
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => splitCsvLine(line));
}

async function parseXlsxAllSheets(buffer: Buffer): Promise<Record<string, string>[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const allRows: Record<string, string>[] = [];

  for (const sheet of workbook.worksheets) {
    const sheetName = sheet.name || 'Sheet';
    // Skip pharmacy movement-only tabs that have no catalog-like headers if score is weak —
    // still try; header detection may find Item Description.
    const matrix: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = (row.values as unknown[]).slice(1).map((value) => cellToString(value));
      // Trim trailing empties
      let end = values.length;
      while (end > 0 && !values[end - 1]) end -= 1;
      matrix.push(values.slice(0, end).map((v) => v.trim()));
    });

    if (!matrix.length) continue;
    const headerIndex = findHeaderRowIndex(matrix);
    const headerScore = scoreHeaderRow(matrix[headerIndex] ?? []);
    // Ignore decorative sheets without recognizable catalog columns
    if (headerScore < 3) continue;

    const itemTypeHint = inferItemTypeFromSheetName(sheetName);
    allRows.push(...rowsFromMatrix(matrix, { sheetName, itemTypeHint }));
  }

  return allRows;
}

export async function parseSpreadsheetRows(
  buffer: Buffer,
  filename: string,
): Promise<Record<string, string>[]> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    return rowsFromMatrix(parseCsvMatrix(buffer.toString('utf8')));
  }
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    return parseXlsxAllSheets(buffer);
  }
  throw new Error('Unsupported file type. Upload a .csv or .xlsx file.');
}

export function pickField(row: Record<string, string>, ...aliases: string[]): string {
  for (const alias of aliases) {
    const key = normalizeHeader(alias);
    const canonical = canonicalizeHeader(alias);
    const direct = row[key] ?? row[canonical];
    if (direct?.trim()) return direct.trim();
  }
  return '';
}

export function resolveRowItemType(
  row: Record<string, string>,
  defaultItemType?: string,
): string {
  const explicit = pickField(
    row,
    'item_type',
    'itemtype',
    'type',
    'catalog_type',
    'product_type',
    'النوع',
    'نوع_الصنف',
  );
  if (explicit) return normalizeCatalogItemType(explicit);
  if (row._item_type_hint) return normalizeCatalogItemType(row._item_type_hint);
  return normalizeCatalogItemType(defaultItemType || CATALOG_ITEM_TYPE.MEDICINE);
}

const INTERNAL_ROW_KEYS = new Set(['_sheet', '_item_type_hint', '_source_row']);

const KNOWN_IMPORT_KEYS = new Set(
  [
    ...Object.keys(HEADER_ALIASES),
    ...Object.values(HEADER_ALIASES).flat().map((alias) => normalizeHeader(alias)),
    'item_description',
    'remaining_qty',
    'remaining',
    'previous_stock_movement',
    'previous_stock',
    'supplied_qty',
    'supplied',
    'total_amount_dispensed',
    'dispensed_qty',
    '#',
    'no',
    'number',
    'sn',
    's_n',
  ].map((key) => normalizeHeader(key)),
);

/** Columns from a parsed row that are not mapped to core catalog fields. */
export function extractUnknownColumns(row: Record<string, string>): Record<string, string> {
  const extras: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!value?.trim()) continue;
    const normalized = normalizeHeader(key);
    if (!normalized || INTERNAL_ROW_KEYS.has(key) || INTERNAL_ROW_KEYS.has(normalized)) continue;
    if (KNOWN_IMPORT_KEYS.has(normalized)) continue;
    // Skip pure dispensed-date columns like dispensed_qty_01_04
    if (normalized.startsWith('dispensed')) continue;
    extras[key] = value.trim();
  }
  return extras;
}

export function collectUnknownColumnNames(rows: Record<string, string>[]): string[] {
  const keys = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(extractUnknownColumns(row))) {
      keys.add(key);
    }
  }
  return [...keys].sort((a, b) => a.localeCompare(b));
}

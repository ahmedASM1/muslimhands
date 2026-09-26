/** Neutralize spreadsheet formula injection for CSV/XLSX cell values. */
export function sanitizeSpreadsheetValue(value: unknown): string | number | boolean {
  if (value == null) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();

  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  return text;
}

export function escapeCsvCell(value: unknown): string {
  const sanitized = sanitizeSpreadsheetValue(value);
  const text = typeof sanitized === 'string' ? sanitized : String(sanitized);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

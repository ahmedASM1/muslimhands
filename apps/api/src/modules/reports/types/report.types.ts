export type ExportFormat = 'csv' | 'xlsx' | 'pdf';

export interface ReportColumn {
  key: string;
  header: string;
}

export interface PaginatedReport<T> {
  items: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ReportExportPayload {
  reportType: string;
  title: string;
  generatedAt: Date;
  filterSummary: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
}

export function estimatedValue(
  quantity: number,
  unitValue: unknown,
): number | null {
  if (unitValue == null || unitValue === '') return null;
  const n = Number(unitValue);
  if (!Number.isFinite(n)) return null;
  return quantity * n;
}

export function stockStatusLabel(input: {
  quantity: number;
  medicineTotal: number;
  minimumStock: number;
  expiry: 'VALID' | 'EXPIRING_SOON' | 'EXPIRED';
}): string {
  if (input.expiry === 'EXPIRED') return 'EXPIRED';
  if (input.quantity <= 0 || input.medicineTotal <= 0) return 'OUT_OF_STOCK';
  if (input.expiry === 'EXPIRING_SOON') return 'EXPIRING_SOON';
  if (input.medicineTotal <= input.minimumStock) return 'LOW_STOCK';
  return 'IN_STOCK';
}

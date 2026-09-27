export type PackLevelInput = {
  code: string;
  label: string;
  factorToBase: number;
  sortOrder?: number;
};

export type PackQuantityEntry = {
  /** Pack level code, or BASE for Medicine.unit */
  code: string;
  quantity: number;
};

/** Convert packaging quantities (cartons/strips/…) into base units (e.g. tablets). */
export function toBaseUnits(
  entries: PackQuantityEntry[],
  levels: Array<{ code: string; factorToBase: number }>,
): number {
  const factorByCode = new Map(
    levels.map((level) => [level.code.toUpperCase(), Math.max(1, level.factorToBase)]),
  );
  factorByCode.set('BASE', 1);
  factorByCode.set('UNIT', 1);

  let total = 0;
  for (const entry of entries) {
    const qty = Number(entry.quantity);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const factor = factorByCode.get(entry.code.toUpperCase()) ?? 1;
    total += Math.round(qty * factor);
  }
  return total;
}

/** Convert base units into a human-readable breakdown when levels exist. */
export function formatFromBaseUnits(
  baseQty: number,
  levels: Array<{ code: string; label: string; factorToBase: number }>,
): string {
  if (!levels.length) return String(baseQty);
  const sorted = [...levels].sort((a, b) => b.factorToBase - a.factorToBase);
  let remaining = Math.max(0, Math.floor(baseQty));
  const parts: string[] = [];
  for (const level of sorted) {
    if (level.factorToBase <= 0) continue;
    const count = Math.floor(remaining / level.factorToBase);
    if (count > 0) {
      parts.push(`${count} ${level.label}`);
      remaining -= count * level.factorToBase;
    }
  }
  if (remaining > 0) parts.push(`${remaining} base`);
  return parts.join(' + ') || '0';
}

export type TimeUnit = 'DAYS' | 'WEEKS' | 'MONTHS';

export function normalizeTimeUnit(raw?: string | null): TimeUnit {
  const upper = String(raw ?? 'DAYS').trim().toUpperCase();
  if (upper === 'WEEK' || upper === 'WEEKS') return 'WEEKS';
  if (upper === 'MONTH' || upper === 'MONTHS') return 'MONTHS';
  return 'DAYS';
}

/** Convert a human lead-time (value + unit) into whole days. */
export function leadTimeToDays(value: number, unit?: string | null): number {
  const amount = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  const normalized = normalizeTimeUnit(unit);
  if (normalized === 'WEEKS') return amount * 7;
  if (normalized === 'MONTHS') return amount * 30;
  return amount;
}

export function suggestDefaultPackLevels(baseUnitName?: string): PackLevelInput[] {
  const base = (baseUnitName ?? 'Unit').trim() || 'Unit';
  return [
    { code: 'CARTON', label: 'Carton', factorToBase: 100, sortOrder: 0 },
    { code: 'STRIP', label: 'Strip', factorToBase: 10, sortOrder: 1 },
    { code: 'BASE', label: base, factorToBase: 1, sortOrder: 2 },
  ];
}

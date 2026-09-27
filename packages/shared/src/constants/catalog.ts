export const CATALOG_ITEM_TYPE = {
  MEDICINE: 'MEDICINE',
  MEDICAL_SUPPLY: 'MEDICAL_SUPPLY',
} as const;

export type SystemCatalogItemType = (typeof CATALOG_ITEM_TYPE)[keyof typeof CATALOG_ITEM_TYPE];

export const SYSTEM_CATALOG_ITEM_TYPES = [
  {
    code: CATALOG_ITEM_TYPE.MEDICINE,
    labelEn: 'Medicines',
    labelAr: 'أدوية',
  },
  {
    code: CATALOG_ITEM_TYPE.MEDICAL_SUPPLY,
    labelEn: 'Medical Supplies',
    labelAr: 'مستلزمات طبية',
  },
] as const;

/** Normalize free-text / known labels into a stable item-type code. */
export function normalizeCatalogItemType(raw?: string | null): string {
  const value = (raw ?? '').trim();
  if (!value) return CATALOG_ITEM_TYPE.MEDICINE;

  const upper = value.toUpperCase().replace(/\s+/g, '_');
  if (upper === CATALOG_ITEM_TYPE.MEDICINE || upper === 'MEDICINES' || upper === 'DRUG' || upper === 'DRUGS') {
    return CATALOG_ITEM_TYPE.MEDICINE;
  }
  if (
    upper === CATALOG_ITEM_TYPE.MEDICAL_SUPPLY ||
    upper === 'MEDICAL_SUPPLIES' ||
    upper === 'SUPPLY' ||
    upper === 'SUPPLIES'
  ) {
    return CATALOG_ITEM_TYPE.MEDICAL_SUPPLY;
  }

  const lower = value.toLowerCase();
  if (lower.includes('دواء') || lower.includes('أدوية') || lower.includes('ادوية')) {
    return CATALOG_ITEM_TYPE.MEDICINE;
  }
  if (lower.includes('مستلزم') || lower.includes('شاش') || lower.includes('supply')) {
    return CATALOG_ITEM_TYPE.MEDICAL_SUPPLY;
  }

  return upper.replace(/[^A-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || CATALOG_ITEM_TYPE.MEDICINE;
}

export function isMedicineItemType(itemType?: string | null): boolean {
  return normalizeCatalogItemType(itemType) === CATALOG_ITEM_TYPE.MEDICINE;
}

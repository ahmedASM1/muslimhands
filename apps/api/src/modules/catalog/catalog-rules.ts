import { DosageForm } from '@mh/shared';

export const BARCODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9\-.]{5,31}$/;

const DOSAGE_FORM_ALIASES: Record<string, DosageForm> = {
  TABLET: DosageForm.TABLET,
  TABLETS: DosageForm.TABLET,
  TAB: DosageForm.TABLET,
  قرص: DosageForm.TABLET,
  أقراص: DosageForm.TABLET,
  اقراص: DosageForm.TABLET,
  CAPSULE: DosageForm.CAPSULE,
  CAPSULES: DosageForm.CAPSULE,
  CAP: DosageForm.CAPSULE,
  كبسولة: DosageForm.CAPSULE,
  كبسولات: DosageForm.CAPSULE,
  SYRUP: DosageForm.SYRUP,
  شراب: DosageForm.SYRUP,
  SUSPENSION: DosageForm.SUSPENSION,
  معلق: DosageForm.SUSPENSION,
  INJECTION: DosageForm.INJECTION,
  حقنة: DosageForm.INJECTION,
  حقن: DosageForm.INJECTION,
  CREAM: DosageForm.CREAM,
  كريم: DosageForm.CREAM,
  OINTMENT: DosageForm.OINTMENT,
  مرهم: DosageForm.OINTMENT,
  DROPS: DosageForm.DROPS,
  قطرة: DosageForm.DROPS,
  قطرات: DosageForm.DROPS,
  INHALER: DosageForm.INHALER,
  بخاخ: DosageForm.INHALER,
  استنشاق: DosageForm.INHALER,
  POWDER: DosageForm.POWDER,
  مسحوق: DosageForm.POWDER,
  OTHER: DosageForm.OTHER,
  أخرى: DosageForm.OTHER,
  اخرى: DosageForm.OTHER,
  other: DosageForm.OTHER,
};

export function normalizeDosageForm(raw?: string | null, fallback: DosageForm = DosageForm.OTHER): DosageForm {
  const value = (raw ?? '').trim();
  if (!value) return fallback;
  const upper = value.toUpperCase().replace(/\s+/g, '_');
  if (Object.values(DosageForm).includes(upper as DosageForm)) {
    return upper as DosageForm;
  }
  const byAlias = DOSAGE_FORM_ALIASES[upper] ?? DOSAGE_FORM_ALIASES[value] ?? DOSAGE_FORM_ALIASES[value.toLowerCase()];
  return byAlias ?? fallback;
}

export function unitCodeFromName(name: string): string {
  const ascii = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  if (ascii.length >= 2) return ascii.slice(0, 24);
  const fallback = `U${Date.now().toString(36).toUpperCase()}`;
  return fallback.slice(0, 24);
}

export function generateSku(name: string, strength?: string): string {
  const prefix = name.replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase().padEnd(4, 'X');
  const digits = (strength ?? '').replace(/\D/g, '').slice(0, 4) || '0000';
  return `${prefix}-${digits}`;
}

export function nextSkuCandidate(base: string, attempt: number): string {
  return attempt <= 1 ? base : `${base}-${attempt}`;
}

export function isValidBarcode(barcode?: string | null): boolean {
  if (!barcode) {
    return true;
  }
  return BARCODE_PATTERN.test(barcode.trim());
}

export function requiresStrength(dosageForm: DosageForm, itemType?: string | null): boolean {
  // Medical supplies and custom non-medicine types do not need strength.
  if (itemType && itemType !== 'MEDICINE') {
    return false;
  }
  return dosageForm !== DosageForm.OTHER;
}

export function validateMedicineNumbers(data: {
  minimumStock?: number;
  reorderQuantity?: number;
  referenceValue?: number | null;
}): string | null {
  if (data.minimumStock !== undefined && data.minimumStock < 0) {
    return 'minimumStock must be 0 or greater';
  }
  if (data.reorderQuantity !== undefined && data.reorderQuantity < 0) {
    return 'reorderQuantity must be 0 or greater';
  }
  if (data.referenceValue !== undefined && data.referenceValue !== null && data.referenceValue < 0) {
    return 'referenceValue must be 0 or greater';
  }
  return null;
}

export function validateBatchDates(manufacturingDate?: Date | null, expiryDate?: Date | null): string | null {
  if (!expiryDate) {
    return 'expiryDate is required';
  }
  if (Number.isNaN(expiryDate.getTime())) {
    return 'expiryDate must be a valid date';
  }
  if (manufacturingDate) {
    if (Number.isNaN(manufacturingDate.getTime())) {
      return 'manufacturingDate must be a valid date';
    }
    if (manufacturingDate > expiryDate) {
      return 'manufacturingDate cannot be after expiryDate';
    }
  }
  return null;
}

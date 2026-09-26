import { DosageForm } from '@mh/shared';

export const BARCODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9\-.]{5,31}$/;

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

export function requiresStrength(dosageForm: DosageForm): boolean {
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

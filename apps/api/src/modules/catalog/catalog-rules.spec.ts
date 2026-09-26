import { DosageForm } from '@mh/shared';
import { expiryStatus } from '../../common/access/access';
import {
  generateSku,
  isValidBarcode,
  nextSkuCandidate,
  requiresStrength,
  validateBatchDates,
  validateMedicineNumbers,
} from './catalog-rules';

describe('catalog rules', () => {
  it('generates a simple SKU from name and strength', () => {
    expect(generateSku('Paracetamol 500mg Tablet', '500mg')).toBe('PARA-500');
    expect(nextSkuCandidate('PARA-500', 2)).toBe('PARA-500-2');
  });

  it('validates optional barcodes', () => {
    expect(isValidBarcode(undefined)).toBe(true);
    expect(isValidBarcode('ABC123')).toBe(true);
    expect(isValidBarcode('bad')).toBe(false);
  });

  it('requires strength except for OTHER dosage forms', () => {
    expect(requiresStrength(DosageForm.TABLET)).toBe(true);
    expect(requiresStrength(DosageForm.OTHER)).toBe(false);
  });

  it('rejects negative medicine numbers', () => {
    expect(validateMedicineNumbers({ minimumStock: -1 })).toBe('minimumStock must be 0 or greater');
    expect(validateMedicineNumbers({ referenceValue: -2 })).toBe('referenceValue must be 0 or greater');
    expect(validateMedicineNumbers({ minimumStock: 0, reorderQuantity: 10 })).toBeNull();
  });

  it('rejects manufacturing dates after expiry', () => {
    expect(
      validateBatchDates(new Date('2028-01-01'), new Date('2027-01-01')),
    ).toBe('manufacturingDate cannot be after expiryDate');
    expect(validateBatchDates(new Date('2026-01-01'), new Date('2028-01-01'))).toBeNull();
  });

  it('derives expiry status from expiry date', () => {
    const expired = new Date();
    expired.setUTCDate(expired.getUTCDate() - 2);
    const soon = new Date();
    soon.setUTCDate(soon.getUTCDate() + 20);
    const valid = new Date();
    valid.setUTCDate(valid.getUTCDate() + 200);
    expect(expiryStatus(expired)).toBe('EXPIRED');
    expect(expiryStatus(soon)).toBe('EXPIRING_SOON');
    expect(expiryStatus(valid)).toBe('VALID');
  });
});

import { DosageForm } from '@mh/shared';
import { parseItemDescription, dosageFormFromUnitLabel } from './catalog-item-parse';

describe('parseItemDescription', () => {
  it('splits DNS-style descriptions with parentheses', () => {
    const parsed = parseItemDescription(
      'DNS 500 mL (Dextrose and Sodium Chloride Injection 500 mL)',
    );
    expect(parsed.name).toContain('DNS');
    expect(parsed.description).toContain('Dextrose');
    expect(parsed.strength?.toLowerCase()).toContain('500');
    expect(parsed.dosageForm).toBe(DosageForm.INJECTION);
    expect(parsed.unitHint).toBe('Infusion');
  });

  it('extracts strength from concentration lines', () => {
    const parsed = parseItemDescription('Metronidazole 5 mg/mL, 100 mL');
    expect(parsed.name.toLowerCase()).toContain('metronidazole');
    expect(parsed.strength?.toLowerCase()).toContain('5');
  });

  it('detects bottle unit hint', () => {
    const parsed = parseItemDescription('Paracetamol 10 mg/mL, 50 mL bottle');
    expect(parsed.unitHint).toBe('Bottle');
    expect(parsed.strength?.toLowerCase()).toContain('10');
  });

  it('maps unit labels to dosage forms', () => {
    expect(dosageFormFromUnitLabel('Infusion')).toBe(DosageForm.INJECTION);
    expect(dosageFormFromUnitLabel('Ampule')).toBe(DosageForm.INJECTION);
    expect(dosageFormFromUnitLabel('vial')).toBe(DosageForm.INJECTION);
  });
});

import { DosageForm } from '@mh/shared';
import { normalizeDosageForm } from './catalog-rules';

export interface ParsedCatalogItem {
  name: string;
  description?: string;
  strength?: string;
  genericName?: string;
  dosageForm?: DosageForm;
  unitHint?: string;
}

const STRENGTH_RE =
  /(\d+(?:[.,]\d+)?\s*(?:mg|mcg|g|µg|ug|iu|ml|mL|l|%|mg\/ml|mg\/mL|mcg\/ml|iu\/ml)\b)/i;

const PAREN_RE = /\(([^)]+)\)\s*$/;

const FORM_HINTS: Array<{ re: RegExp; form: DosageForm; unit?: string }> = [
  { re: /\b(infusion|iv\s*infusion|dns|rls|ns\b|normal saline)\b/i, form: DosageForm.INJECTION, unit: 'Infusion' },
  { re: /\b(ampoule|ampule|amp)\b/i, form: DosageForm.INJECTION, unit: 'Ampoule' },
  { re: /\b(vial|vials)\b/i, form: DosageForm.INJECTION, unit: 'Vial' },
  { re: /\b(injection|inj\.?|syringe)\b/i, form: DosageForm.INJECTION },
  { re: /\b(syrup|oral solution)\b/i, form: DosageForm.SYRUP },
  { re: /\b(suspension)\b/i, form: DosageForm.SUSPENSION },
  { re: /\b(tablet|tab\.?|أقراص|قرص)\b/i, form: DosageForm.TABLET },
  { re: /\b(capsule|cap\.?|كبسولة)\b/i, form: DosageForm.CAPSULE },
  { re: /\b(cream|كريم)\b/i, form: DosageForm.CREAM },
  { re: /\b(ointment|مرهم)\b/i, form: DosageForm.OINTMENT },
  { re: /\b(drops|قطرة|eye drop|ear drop)\b/i, form: DosageForm.DROPS },
  { re: /\b(inhaler|nebul|بخاخ)\b/i, form: DosageForm.INHALER },
  { re: /\b(powder|مسحوق)\b/i, form: DosageForm.POWDER },
  { re: /\b(bottle|bot\.?)\b/i, form: DosageForm.OTHER, unit: 'Bottle' },
];

/**
 * Split a free-text stock-sheet "Item Description" into catalog fields.
 * Examples:
 *  - DNS 500 mL (Dextrose and Sodium Chloride Injection 500 mL)
 *  - Metronidazole 5 mg/mL, 100 mL
 *  - Paracetamol 10 mg/mL, 50 mL bottle
 */
export function parseItemDescription(raw: string): ParsedCatalogItem {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return { name: '' };

  let description: string | undefined;
  let working = text;
  const paren = working.match(PAREN_RE);
  if (paren?.[1]) {
    description = paren[1].trim();
    working = working.replace(PAREN_RE, '').trim();
  }

  const strengthMatch = working.match(STRENGTH_RE) ?? description?.match(STRENGTH_RE);
  const strength = strengthMatch?.[1]?.replace(',', '.').trim();

  let dosageForm: DosageForm | undefined;
  let unitHint: string | undefined;
  const haystack = `${working} ${description ?? ''}`;
  for (const hint of FORM_HINTS) {
    if (hint.re.test(haystack)) {
      dosageForm = hint.form;
      if (hint.unit) unitHint = hint.unit;
      break;
    }
  }

  // Short display name: prefer text before first comma if long, else primary working text
  let name = working;
  if (name.length > 80 && name.includes(',')) {
    name = name.split(',')[0]!.trim();
  }
  if (!name && description) name = description;
  if (name.length < 2) name = text.slice(0, 120);

  // Generic: if description looks like a chemical name, use first token phrase
  let genericName: string | undefined;
  if (description && !/^\d/.test(description)) {
    const genericCandidate = description.replace(/\b(injection|infusion|solution|suspension|syrup|tablet|capsule|cream|ointment|drops)\b/gi, '').trim();
    if (genericCandidate.length >= 3 && genericCandidate.length <= 80) {
      genericName = genericCandidate.replace(/,.*$/, '').trim() || undefined;
    }
  }

  // Keep full original as description when we stripped parentheses or name was shortened
  if (!description && text !== name) {
    description = text;
  } else if (description && text !== name) {
    description = text;
  }

  return {
    name,
    description: description && description !== name ? description : undefined,
    strength,
    genericName,
    dosageForm,
    unitHint,
  };
}

export function dosageFormFromUnitLabel(unitRaw?: string | null): DosageForm | undefined {
  if (!unitRaw?.trim()) return undefined;
  const mapped = normalizeDosageForm(unitRaw, DosageForm.OTHER);
  // Unit labels like Infusion/Ampoule are not dosage enum values — map manually
  const lower = unitRaw.toLowerCase();
  if (lower.includes('infusion')) return DosageForm.INJECTION;
  if (lower.includes('ampoule') || lower.includes('ampule') || lower.includes('vial')) {
    return DosageForm.INJECTION;
  }
  if (mapped !== DosageForm.OTHER) return mapped;
  return undefined;
}

export const DOSAGE_FORMS = [
  'TABLET',
  'CAPSULE',
  'SYRUP',
  'SUSPENSION',
  'INJECTION',
  'CREAM',
  'OINTMENT',
  'DROPS',
  'INHALER',
  'POWDER',
  'OTHER',
] as const;

export type DosageForm = (typeof DOSAGE_FORMS)[number];

export function formatLabel(value: string) {
  return value.replaceAll('_', ' ').toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());
}

export function dosageFormLabel(
  t: (key: string) => string,
  value: string,
): string {
  const key = `dosageForms.${value}`;
  const label = t(key);
  return label === key ? formatLabel(value) : label;
}

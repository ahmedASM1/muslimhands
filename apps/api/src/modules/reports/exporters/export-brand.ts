/** Shared visual identity for catalog / report exports. */
export const EXPORT_BRAND = {
  name: 'Muslim Hands',
  system: 'Medicine Distribution System',
  tagline: 'Muslim Hands — Medicine Distribution System',
  confidential: 'Confidential — for internal use only',
  primary: '#0D7377',
  primaryDark: '#095456',
  primarySoft: '#F0FDFA',
  accent: '#14B8A6',
  text: '#0F172A',
  muted: '#64748B',
  border: '#CBD5E1',
  white: '#FFFFFF',
  // Excel ARGB (no #)
  excel: {
    primary: '0D7377',
    primaryDark: '095456',
    primarySoft: 'F0FDFA',
    accent: '14B8A6',
    text: '0F172A',
    muted: '64748B',
    border: 'CBD5E1',
    white: 'FFFFFF',
    headerBg: '0D7377',
    zebra: 'F0FDFA',
    metaBg: 'ECFEFF',
  },
} as const;

export function formatExportTimestamp(date: Date): string {
  return date.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

export function formatExportDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

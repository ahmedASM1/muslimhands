import { DEFAULT_LOCALE, intlLocale, type AppLocale } from '@/i18n/config';

function localeOrDefault(locale?: AppLocale) {
  return intlLocale(locale ?? DEFAULT_LOCALE);
}

export function formatDate(value?: string | Date | null, locale?: AppLocale) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(localeOrDefault(locale), {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(date);
}

export function formatDateTime(value?: string | Date | null, locale?: AppLocale) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(localeOrDefault(locale), {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatQuantity(value?: number | null, locale?: AppLocale) {
  if (value == null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat(localeOrDefault(locale), {
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatEstimatedValue(value?: number | null, locale?: AppLocale) {
  if (value == null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat(localeOrDefault(locale), {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

export function relativeTime(value?: string | Date | null, locale?: AppLocale) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const deltaSec = Math.round((date.getTime() - Date.now()) / 1000);
  const abs = Math.abs(deltaSec);
  const rtf = new Intl.RelativeTimeFormat(localeOrDefault(locale), { numeric: 'auto' });
  if (abs < 60) return rtf.format(Math.round(deltaSec), 'second');
  if (abs < 3600) return rtf.format(Math.round(deltaSec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(deltaSec / 3600), 'hour');
  return rtf.format(Math.round(deltaSec / 86400), 'day');
}

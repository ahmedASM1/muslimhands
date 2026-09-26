export type AppLocale = 'en' | 'ar';

export const LOCALES: AppLocale[] = ['en', 'ar'];
export const DEFAULT_LOCALE: AppLocale = 'en';
export const LOCALE_COOKIE = 'mh-locale';
export const LOCALE_STORAGE_KEY = 'mh-locale';

export function isAppLocale(value: unknown): value is AppLocale {
  return value === 'en' || value === 'ar';
}

export function localeDirection(locale: AppLocale): 'ltr' | 'rtl' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

export function localeHtmlLang(locale: AppLocale): string {
  return locale === 'ar' ? 'ar' : 'en';
}

export function intlLocale(locale: AppLocale): string {
  return locale === 'ar' ? 'ar' : 'en-GB';
}

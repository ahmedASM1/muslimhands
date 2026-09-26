'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_STORAGE_KEY,
  isAppLocale,
  localeDirection,
  localeHtmlLang,
  type AppLocale,
} from './config';
import { translate, type TranslateParams } from './translate';

type I18nContextValue = {
  locale: AppLocale;
  dir: 'ltr' | 'rtl';
  t: (key: string, params?: TranslateParams) => string;
  setLocale: (locale: AppLocale) => void;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function readStoredLocale(): AppLocale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  try {
    const fromStorage = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isAppLocale(fromStorage)) return fromStorage;
  } catch {
    /* ignore */
  }
  const match = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`));
  const fromCookie = match?.[1] ? decodeURIComponent(match[1]) : null;
  if (isAppLocale(fromCookie)) return fromCookie;
  const htmlLang = document.documentElement.lang;
  if (htmlLang?.startsWith('ar')) return 'ar';
  return DEFAULT_LOCALE;
}

function persistLocale(locale: AppLocale) {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
  const maxAge = 60 * 60 * 24 * 365;
  document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(locale)}; path=/; max-age=${maxAge}; samesite=lax`;
}

function applyDocumentLocale(locale: AppLocale) {
  const root = document.documentElement;
  root.lang = localeHtmlLang(locale);
  root.dir = localeDirection(locale);
  root.dataset.locale = locale;
}

export function LocaleProvider({
  children,
  initialLocale,
}: {
  children: ReactNode;
  initialLocale?: AppLocale;
}) {
  const [locale, setLocaleState] = useState<AppLocale>(initialLocale ?? DEFAULT_LOCALE);

  useEffect(() => {
    const stored = readStoredLocale();
    setLocaleState(stored);
    applyDocumentLocale(stored);
  }, []);

  const setLocale = useCallback((next: AppLocale) => {
    setLocaleState(next);
    persistLocale(next);
    applyDocumentLocale(next);
  }, []);

  const value = useMemo<I18nContextValue>(() => {
    const dir = localeDirection(locale);
    return {
      locale,
      dir,
      setLocale,
      t: (key, params) => translate(locale, key, params),
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within LocaleProvider');
  }
  return ctx;
}

/** Safe translate for optional contexts (falls back to key). */
export function useOptionalI18n() {
  return useContext(I18nContext);
}

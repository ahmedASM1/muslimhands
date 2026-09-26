import type { AppLocale } from './config';
import ar from './messages/ar.json';
import en from './messages/en.json';

export type MessageTree = typeof en;

const catalogs: Record<AppLocale, MessageTree> = {
  en,
  ar: ar as MessageTree,
};

export type TranslateParams = Record<string, string | number>;

function getByPath(tree: MessageTree, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, tree);
}

export function translate(
  locale: AppLocale,
  key: string,
  params?: TranslateParams,
  fallbackLocale: AppLocale = 'en',
): string {
  const raw =
    getByPath(catalogs[locale], key) ??
    (locale !== fallbackLocale ? getByPath(catalogs[fallbackLocale], key) : undefined);

  if (typeof raw !== 'string') return key;

  if (!params) return raw;
  return raw.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const value = params[name];
    return value == null ? '' : String(value);
  });
}

export function getMessages(locale: AppLocale): MessageTree {
  return catalogs[locale];
}

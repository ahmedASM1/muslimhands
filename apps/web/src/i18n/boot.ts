import { LOCALE_COOKIE, isAppLocale, type AppLocale } from './config';

/** Inline script to set dir/lang before paint (avoids RTL flash). */
export function localeBootScript(): string {
  return `(function(){try{var k=${JSON.stringify(LOCALE_COOKIE)};var s=null;try{s=localStorage.getItem(k);}catch(e){}if(!s){var m=document.cookie.match(new RegExp('(?:^|; )'+k+'=([^;]*)'));s=m?decodeURIComponent(m[1]):null;}var l=(s==='ar'||s==='en')?s:'en';var d=l==='ar'?'rtl':'ltr';var r=document.documentElement;r.lang=l==='ar'?'ar':'en';r.dir=d;r.dataset.locale=l;}catch(e){}})();`;
}

export function parseLocaleCookie(cookieHeader?: string | null): AppLocale | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]*)`));
  const value = match?.[1] ? decodeURIComponent(match[1]) : null;
  return isAppLocale(value) ? value : null;
}

const ACCESS_TOKEN_KEY = 'mh.accessToken';
const REFRESH_TOKEN_KEY = 'mh.refreshToken';

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.sessionStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.sessionStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setSessionTokens(accessToken: string, refreshToken: string): void {
  window.sessionStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  window.sessionStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

export function clearSessionTokens(): void {
  window.sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  window.sessionStorage.removeItem(REFRESH_TOKEN_KEY);
}

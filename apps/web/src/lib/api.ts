import type { ApiErrorResponse, ApiSuccessResponse, AuthSession, PaginationMeta } from '@mh/shared';
import {
  clearSessionTokens,
  getAccessToken,
  getRefreshToken,
  setSessionTokens,
} from '@/lib/auth-storage';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  token?: string | null;
  headers?: Record<string, string>;
  /** Internal: skip refresh retry to prevent loops */
  _retry?: boolean;
}

let refreshInFlight: Promise<boolean> | null = null;

async function tryRefreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return false;

    try {
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
        credentials: 'include',
      });
      const payload = (await response.json()) as ApiSuccessResponse<AuthSession> | ApiErrorResponse;
      if (!response.ok || !payload.success) {
        clearSessionTokens();
        return false;
      }
      setSessionTokens(payload.data.tokens.accessToken, payload.data.tokens.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export async function refreshSession(): Promise<boolean> {
  return tryRefreshSession();
}

async function parseJsonSafe(response: Response) {
  try {
    return (await response.json()) as ApiSuccessResponse<unknown> | ApiErrorResponse;
  } catch {
    return null;
  }
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers ?? {}),
  };
  const token = options.token ?? getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'include',
  });

  if (response.status === 401 && !options._retry && !path.startsWith('/auth/')) {
    const refreshed = await tryRefreshSession();
    if (refreshed) {
      return apiRequest<T>(path, { ...options, token: getAccessToken(), _retry: true });
    }
  }

  const payload = await parseJsonSafe(response);
  if (!payload || !response.ok || !payload.success) {
    const error = payload && !payload.success ? payload.error : undefined;
    throw new ApiClientError(error?.message ?? 'Request failed', response.status, error?.code);
  }
  return payload.data as T;
}

export async function apiList<T>(path: string): Promise<{ items: T[]; meta?: PaginationMeta }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let response = await fetch(`${API_URL}${path}`, { headers, credentials: 'include' });

  if (response.status === 401) {
    const refreshed = await tryRefreshSession();
    if (refreshed) {
      const retryHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      const nextToken = getAccessToken();
      if (nextToken) retryHeaders.Authorization = `Bearer ${nextToken}`;
      response = await fetch(`${API_URL}${path}`, { headers: retryHeaders, credentials: 'include' });
    }
  }

  const payload = await parseJsonSafe(response);
  if (!payload || !response.ok || !payload.success) {
    const error = payload && !payload.success ? payload.error : undefined;
    throw new ApiClientError(error?.message ?? 'Request failed', response.status, error?.code);
  }
  return {
    items: (payload as ApiSuccessResponse<T[]>).data,
    meta: (payload as ApiSuccessResponse<T[]>).meta,
  };
}

export async function apiDownload(path: string, filename: string) {
  const token = getAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  let response = await fetch(`${API_URL}${path}`, { headers, credentials: 'include' });

  if (response.status === 401) {
    const refreshed = await tryRefreshSession();
    if (refreshed) {
      const retryHeaders: Record<string, string> = {};
      const nextToken = getAccessToken();
      if (nextToken) retryHeaders.Authorization = `Bearer ${nextToken}`;
      response = await fetch(`${API_URL}${path}`, { headers: retryHeaders, credentials: 'include' });
    }
  }

  if (!response.ok) {
    throw new ApiClientError('Download failed', response.status);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

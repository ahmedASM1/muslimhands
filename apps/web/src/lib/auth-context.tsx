'use client';

import type { AuthenticatedUser, AuthSession } from '@mh/shared';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiRequest, refreshSession } from '@/lib/api';
import { clearSessionTokens, getAccessToken, getRefreshToken, setSessionTokens } from '@/lib/auth-storage';

interface AuthContextValue {
  user: AuthenticatedUser | null;
  loading: boolean;
  setSession: (session: AuthSession) => void;
  refreshUser: () => Promise<AuthenticatedUser | null>;
  logout: () => Promise<void> | void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  setSession: () => undefined,
  refreshUser: async () => null,
  logout: () => undefined,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getAccessToken();
    const refreshToken = getRefreshToken();
    if (!token && !refreshToken) {
      setLoading(false);
      return;
    }

    void (async () => {
      try {
        const me = await apiRequest<AuthenticatedUser>('/auth/me');
        setUser(me);
      } catch {
        const refreshed = await refreshSession();
        if (refreshed) {
          try {
            const me = await apiRequest<AuthenticatedUser>('/auth/me');
            setUser(me);
            return;
          } catch {
            // fall through
          }
        }
        clearSessionTokens();
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        setSession: (session) => {
          setSessionTokens(session.tokens.accessToken, session.tokens.refreshToken);
          setUser(session.user);
        },
        refreshUser: async () => {
          try {
            const me = await apiRequest<AuthenticatedUser>('/auth/me');
            setUser(me);
            return me;
          } catch {
            return null;
          }
        },
        logout: async () => {
          const refreshToken = getRefreshToken();
          if (refreshToken) {
            try {
              await apiRequest('/auth/logout', { method: 'POST', body: { refreshToken } });
            } catch {
              // Session is cleared locally even if the API is unreachable.
            }
          }
          clearSessionTokens();
          setUser(null);
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export { hasPermission } from '@/lib/permissions';

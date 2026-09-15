'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { AuthUser, ModuleKey } from '@/types';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

// ─── Context type ─────────────────────────────────────────────────────────────

interface AuthContextValue {
  user:      AuthUser | null;
  loading:   boolean;
  logout:    () => Promise<void>;
  canView:   (module: ModuleKey) => boolean;
  canManage: (module: ModuleKey) => boolean;
  refresh:   () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ─── Device pairing (kiosk tablets that skip login) ────────────────────────────

export const DEVICE_TOKEN_KEY = 'lrc_device_token';

/** Scambia il token di dispositivo salvato in questo browser per una sessione normale. */
async function tryDeviceLogin(): Promise<boolean> {
  let deviceToken: string | null = null;
  try { deviceToken = localStorage.getItem(DEVICE_TOKEN_KEY); } catch { return false; }
  if (!deviceToken) return false;

  try {
    const res = await fetch(`${BACKEND}/api/auth/devices/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body:    JSON.stringify({ device_token: deviceToken }),
      signal:  AbortSignal.timeout(10_000),
    });
    if (res.ok) return true;
    if (res.status === 401) {
      // Token revocato o sconosciuto: non ha senso ritentare ad ogni caricamento
      try { localStorage.removeItem(DEVICE_TOKEN_KEY); } catch {}
    }
    return false;
  } catch {
    return false;
  }
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user,    setUser]    = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      let res = await fetch(`${BACKEND}/api/auth/me`, {
        credentials: 'include',
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 401 && await tryDeviceLogin()) {
        res = await fetch(`${BACKEND}/api/auth/me`, {
          credentials: 'include',
          signal: AbortSignal.timeout(10_000),
        });
      }
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else if (res.status === 401) {
        // Explicit 401 = not logged in
        setUser(null);
      }
      // Other HTTP errors (5xx, network issues): preserve existing user state
    } catch {
      // Network error or timeout: do not log out, just stop loading
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const logout = useCallback(async () => {
    await fetch(`${BACKEND}/api/auth/logout`, { method: 'POST', credentials: 'include' });
    setUser(null);
  }, []);

  const canView   = useCallback((module: ModuleKey) =>
    user?.role === 'admin' || (user?.permissions.some(p => p.module_key === module && p.can_view)   ?? false),
  [user]);

  const canManage = useCallback((module: ModuleKey) =>
    user?.role === 'admin' || (user?.permissions.some(p => p.module_key === module && p.can_manage) ?? false),
  [user]);

  return (
    <AuthContext.Provider value={{ user, loading, logout, canView, canManage, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

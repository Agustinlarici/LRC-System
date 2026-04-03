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

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user,    setUser]    = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND}/api/auth/me`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
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
    user?.permissions.some(p => p.module_key === module && p.can_view)   ?? false,
  [user]);

  const canManage = useCallback((module: ModuleKey) =>
    user?.permissions.some(p => p.module_key === module && p.can_manage) ?? false,
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

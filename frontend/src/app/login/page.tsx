'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

export default function LoginPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  async function doLogin(u: string, p: string) {
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND}/api/auth/login`, {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'include',
        body:        JSON.stringify({ username: u, password: p }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message ?? 'Credenziali non valide');
        return;
      }
      await refresh();
      const redirectTo = sessionStorage.getItem('redirect_after_login') ?? '/';
      sessionStorage.removeItem('redirect_after_login');
      router.push(redirectTo);
    } catch {
      setError('Errore di connessione al server');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await doLogin(username, password);
  }

  function loginAsGuest() {
    doLogin('guest', 'guest');
  }

  return (
    <div className="min-h-screen bg-zinc-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        <div className="bg-white rounded-2xl shadow-lg p-8">
          {/* Logo */}
          <div className="flex justify-center mb-8">
            <img src="/logo.png" alt="STR" className="h-12 object-contain" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                required
                autoFocus
                autoComplete="username"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white rounded-lg px-4 py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Accesso in corso…' : 'Accedi'}
            </button>
          </form>

          {/* Guest button — will be removed in a future phase */}
          <div className="mt-4 pt-4 border-t border-gray-100">
            <button
              onClick={loginAsGuest}
              disabled={loading}
              className="w-full text-sm text-gray-500 border border-gray-200 rounded-lg px-4 py-2 hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              Accedi senza credenziali
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

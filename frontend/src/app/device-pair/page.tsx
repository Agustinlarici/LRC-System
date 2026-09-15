'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, DEVICE_TOKEN_KEY } from '@/lib/auth';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

export default function DevicePairPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND}/api/auth/devices/pair/redeem`, {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'include',
        body:        JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message ?? 'Codice non valido');
        return;
      }
      try { localStorage.setItem(DEVICE_TOKEN_KEY, data.device_token); } catch {}
      await refresh();
      setDone(true);
      setTimeout(() => router.push('/qualita/tablet'), 1500);
    } catch {
      setError('Errore di connessione al server');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-lg p-8">
          <div className="flex justify-center mb-6">
            <img src="/logo.png" alt="STR" className="h-12 object-contain" />
          </div>

          <h1 className="text-lg font-bold text-gray-900 text-center mb-1">Associa questo dispositivo</h1>
          <p className="text-sm text-gray-500 text-center mb-6">
            Inserisci il codice a 6 cifre generato dall'amministratore. Da questo momento il
            dispositivo entrerà sempre con lo stesso utente, senza chiedere la password.
          </p>

          {done ? (
            <p className="text-sm text-green-600 bg-green-50 border border-green-200 rounded-lg px-3 py-3 text-center">
              Dispositivo associato. Reindirizzamento…
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
                autoFocus
                placeholder="000000"
                className="w-full border border-gray-300 rounded-lg px-3 py-3 text-center text-2xl tracking-[0.5em] font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading || code.length !== 6}
                className="w-full bg-blue-600 text-white rounded-lg px-4 py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Associazione in corso…' : 'Associa'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

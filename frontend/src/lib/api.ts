/**
 * API client — browser calls backend directly on port 3001 (no Next.js proxy hop).
 */

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`  // browser → mismo host, puerto 3001
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');          // SSR → Docker service

const REQUEST_TIMEOUT_MS = 15_000;

async function request<T>(method: string, path: string, body?: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const res = await fetch(`${BACKEND}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body:        body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'include',
    signal:      AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string; message?: string };
    throw new Error(err.error ?? err.message ?? `HTTP ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get:    <T>(path: string, timeoutMs?: number)                 => request<T>('GET',    path, undefined, timeoutMs),
  post:   <T>(path: string, body?: unknown, timeoutMs?: number) => request<T>('POST',   path, body, timeoutMs),
  patch:  <T>(path: string, body?: unknown, timeoutMs?: number) => request<T>('PATCH',  path, body, timeoutMs),
  put:    <T>(path: string, body?: unknown, timeoutMs?: number) => request<T>('PUT',    path, body, timeoutMs),
  delete: <T>(path: string, timeoutMs?: number)                 => request<T>('DELETE', path, undefined, timeoutMs),
};

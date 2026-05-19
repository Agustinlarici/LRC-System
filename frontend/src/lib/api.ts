/**
 * API client — browser calls backend directly on port 3001 (no Next.js proxy hop).
 */

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`  // browser → mismo host, puerto 3001
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');          // SSR → Docker service

const REQUEST_TIMEOUT_MS = 15_000;

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BACKEND}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body:        body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'include',
    signal:      AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string; message?: string };
    throw new Error(err.error ?? err.message ?? `HTTP ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get:    <T>(path: string)                 => request<T>('GET',    path),
  post:   <T>(path: string, body?: unknown) => request<T>('POST',   path, body),
  patch:  <T>(path: string, body?: unknown) => request<T>('PATCH',  path, body),
  put:    <T>(path: string, body?: unknown) => request<T>('PUT',    path, body),
  delete: <T>(path: string)                 => request<T>('DELETE', path),
};

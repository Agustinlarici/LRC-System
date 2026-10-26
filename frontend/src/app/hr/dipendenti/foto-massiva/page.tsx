'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import type { HrEmployee } from '@/types';
import { resizePhoto, rankCandidates, matchLevel, type MatchLevel, type PhotoCandidate } from '@/lib/hrPhoto';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

type RowStatus = 'idle' | 'uploading' | 'done' | 'error' | 'skipped';

interface Row {
  key: number;
  file: File;
  url: string | null;          // anteprima (null se il formato non è supportato)
  supported: boolean;
  candidates: PhotoCandidate[];
  level: MatchLevel;
  employeeId: number | null;   // dipendente scelto (automatico o manuale)
  status: RowStatus;
  message: string;
}

const LEVEL_STYLE: Record<MatchLevel, string> = {
  green: 'bg-green-50 text-green-700 border-green-200',
  yellow: 'bg-amber-50 text-amber-700 border-amber-200',
  red: 'bg-red-50 text-red-700 border-red-200',
};
const LEVEL_LABEL: Record<MatchLevel, string> = { green: 'Sicuro', yellow: 'Da verificare', red: 'Nessun abbinamento' };

export default function FotoMassivaPage() {
  const { canManage } = useAuth();
  const manage = canManage('hr');

  const [employees, setEmployees] = useState<HrEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [overwrite, setOverwrite] = useState(false);
  const [running, setRunning] = useState(false);
  const [filter, setFilter] = useState<'all' | MatchLevel>('all');
  const nextKey = useRef(1);
  const urlsRef = useRef<string[]>([]);
  const stopRef = useRef(false);

  useEffect(() => {
    fetch(`${BACKEND}/api/hr/employees`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(setEmployees)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => () => { urlsRef.current.forEach(u => URL.revokeObjectURL(u)); }, []);

  const byId = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees]);
  const sortedEmployees = useMemo(
    () => [...employees].sort((a, b) => `${a.cognome} ${a.nome}`.localeCompare(`${b.cognome} ${b.nome}`)),
    [employees],
  );

  function empLabel(e: HrEmployee) {
    return `${e.cognome} ${e.nome}${e.stato === 'cessato' ? ' (cessato)' : ''}${e.photo_version ? ' · ha già foto' : ''}`;
  }

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    urlsRef.current.forEach(u => URL.revokeObjectURL(u));
    urlsRef.current = [];
    const taken = new Set<number>();
    const next: Row[] = [];
    // Ordine alfabetico: i doppioni (es. "ADNAN" e "ADNAN ARIF") finiscono vicini
    const files = Array.from(list).sort((a, b) => a.name.localeCompare(b.name));
    for (const file of files) {
      const supported = PHOTO_TYPES.has(file.type);
      const url = supported ? URL.createObjectURL(file) : null;
      if (url) urlsRef.current.push(url);
      const candidates = supported ? rankCandidates(file.name, employees) : [];
      const level = matchLevel(candidates);
      // Scelta automatica solo se sicura e se quel dipendente non ha già un'altra foto in lista
      let employeeId: number | null = null;
      if (level === 'green' && !taken.has(candidates[0].id)) { employeeId = candidates[0].id; taken.add(employeeId); }
      next.push({ key: nextKey.current++, file, url, supported, candidates, level: employeeId === null && level === 'green' ? 'yellow' : level, employeeId, status: 'idle', message: '' });
    }
    setRows(next);
    setFilter('all');
  }

  function patch(key: number, p: Partial<Row>) {
    setRows(rs => rs.map(r => r.key === key ? { ...r, ...p } : r));
  }

  // Dipendenti scelti più di una volta: si carica solo la prima foto
  const duplicates = useMemo(() => {
    const seen = new Set<number>(), dup = new Set<number>();
    for (const r of rows) {
      if (r.employeeId === null) continue;
      if (seen.has(r.employeeId)) dup.add(r.key); else seen.add(r.employeeId);
    }
    return dup;
  }, [rows]);

  function skipReason(r: Row): string | null {
    if (!r.supported) return 'Formato non supportato (usa JPG, PNG o WebP)';
    if (r.employeeId === null) return 'Nessun dipendente scelto';
    if (duplicates.has(r.key)) return 'Stesso dipendente di un\'altra foto';
    if (!overwrite && byId.get(r.employeeId)?.photo_version) return 'Ha già una foto';
    return null;
  }

  const toUpload = rows.filter(r => r.status !== 'done' && !skipReason(r));

  async function uploadAll() {
    setRunning(true);
    stopRef.current = false;
    for (const r of rows) {
      if (stopRef.current) break;   // "Ferma": le foto già caricate restano
      if (r.status === 'done') continue;
      const reason = skipReason(r);
      if (reason) { patch(r.key, { status: 'skipped', message: reason }); continue; }
      patch(r.key, { status: 'uploading', message: '' });
      try {
        const form = new FormData();
        form.append('file', await resizePhoto(r.file), 'foto.jpg');
        const res = await fetch(`${BACKEND}/api/hr/employees/${r.employeeId}/photo`, { method: 'PUT', credentials: 'include', body: form });
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? 'Caricamento non riuscito');
        patch(r.key, { status: 'done', message: '' });
      } catch (err) {
        patch(r.key, { status: 'error', message: err instanceof Error ? err.message : 'Caricamento non riuscito' });
      }
    }
    setRunning(false);
    // Aggiorna "ha già foto" per le righe successive
    const res = await fetch(`${BACKEND}/api/hr/employees`, { credentials: 'include' });
    if (res.ok) setEmployees(await res.json());
  }

  const counts = {
    green: rows.filter(r => r.level === 'green').length,
    yellow: rows.filter(r => r.level === 'yellow').length,
    red: rows.filter(r => r.level === 'red').length,
    done: rows.filter(r => r.status === 'done').length,
    error: rows.filter(r => r.status === 'error').length,
    skipped: rows.filter(r => r.status === 'skipped').length,
  };
  const visible = rows.filter(r => filter === 'all' || r.level === filter);

  if (!manage) return <p className="text-sm text-gray-500 text-center py-16">Non hai i permessi per caricare le foto.</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <Link href="/hr/dipendenti" className="text-xs text-gray-400 hover:text-gray-600">← Dipendenti</Link>
          <h1 className="text-lg font-medium text-gray-900">Carica foto in blocco</h1>
        </div>
        <div className="flex items-center gap-2">
          <label className="btn-secondary text-sm cursor-pointer">
            Scegli cartella
            <input type="file" className="hidden" multiple disabled={running || loading}
              {...{ webkitdirectory: '', directory: '' }}
              onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
          </label>
          <label className="btn-secondary text-sm cursor-pointer">
            Scegli file
            <input type="file" className="hidden" multiple accept="image/*,.pdf" disabled={running || loading}
              onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
          </label>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card text-sm text-gray-500 space-y-1">
          <p>Scegli la cartella con le foto: il nome del file (es. <b>ROSSI MARIO.jpg</b> o <b>Mario Rossi.jpeg</b>) si abbina al dipendente, in qualsiasi ordine e anche con piccoli errori di battitura.</p>
          <p>Prima del caricamento puoi controllare e correggere ogni abbinamento. Le foto vengono ridimensionate a 700 px.</p>
          {loading && <p className="text-gray-400">Caricamento dipendenti…</p>}
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap text-sm">
            {([['all', `Tutte (${rows.length})`], ['green', `Sicure (${counts.green})`], ['yellow', `Da verificare (${counts.yellow})`], ['red', `Senza abbinamento (${counts.red})`]] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setFilter(k)}
                className={`px-3 py-1 rounded-full border text-xs ${filter === k ? 'bg-blue-50 border-blue-300 text-blue-700 font-medium' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>{label}</button>
            ))}
            <label className="flex items-center gap-2 text-xs text-gray-600 ml-auto">
              <input type="checkbox" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} disabled={running} />
              Sostituisci le foto già presenti
            </label>
            {running && <button type="button" onClick={() => { stopRef.current = true; }} className="btn-secondary text-sm">Ferma</button>}
            <button type="button" onClick={uploadAll} disabled={running || toUpload.length === 0} className="btn-primary text-sm">
              {running ? `Caricamento… ${counts.done}` : `Carica ${toUpload.length} foto`}
            </button>
          </div>

          {(counts.done > 0 || counts.error > 0 || counts.skipped > 0) && (
            <p className="text-sm text-gray-600">
              Caricate: <b className="text-green-700">{counts.done}</b>
              {counts.error > 0 && <> · Errori: <b className="text-red-700">{counts.error}</b></>}
              {counts.skipped > 0 && <> · Saltate: <b>{counts.skipped}</b></>}
            </p>
          )}

          <div className="card !p-0 divide-y divide-gray-100">
            {visible.map(r => {
              const reason = r.status === 'idle' ? skipReason(r) : null;
              const options = r.candidates.map(c => byId.get(c.id)).filter((e): e is HrEmployee => !!e);
              return (
                <div key={r.key} className="flex items-center gap-3 p-3">
                  {r.url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={r.url} alt="" loading="lazy" className="w-12 h-12 rounded-full object-cover bg-gray-100 shrink-0" />
                    : <div className="w-12 h-12 rounded-full bg-gray-100 text-[10px] text-gray-400 flex items-center justify-center shrink-0">N/D</div>}
                  <div className="w-64 min-w-0">
                    <p className="text-sm text-gray-800 truncate" title={r.file.name}>{r.file.name}</p>
                    <span className={`inline-block mt-0.5 text-[11px] border rounded-full px-2 ${LEVEL_STYLE[r.level]}`}>{LEVEL_LABEL[r.level]}</span>
                  </div>
                  <select
                    className="input text-sm flex-1 min-w-0"
                    value={r.employeeId ?? ''}
                    disabled={running || !r.supported || r.status === 'done'}
                    onChange={e => patch(r.key, { employeeId: e.target.value ? Number(e.target.value) : null, status: 'idle', message: '' })}
                  >
                    <option value="">— Nessun dipendente (salta) —</option>
                    {options.length > 0 && <optgroup label="Più probabili">
                      {options.map(e => <option key={e.id} value={e.id}>{empLabel(e)}</option>)}
                    </optgroup>}
                    <optgroup label="Tutti i dipendenti">
                      {sortedEmployees.filter(e => !options.includes(e)).map(e => <option key={e.id} value={e.id}>{empLabel(e)}</option>)}
                    </optgroup>
                  </select>
                  <div className="w-44 text-xs text-right shrink-0">
                    {r.status === 'done' && <span className="text-green-700">Caricata ✓</span>}
                    {r.status === 'uploading' && <span className="text-gray-400">Caricamento…</span>}
                    {r.status === 'error' && <span className="text-red-600">{r.message}</span>}
                    {r.status === 'skipped' && <span className="text-gray-500">Saltata: {r.message}</span>}
                    {r.status === 'idle' && reason && <span className="text-gray-400">{reason}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

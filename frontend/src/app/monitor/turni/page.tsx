'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { today, fmtDate, addDays } from '@/lib/utils';
import { useToast } from '@/components/ui/Toast';
import { PageLoader } from '@/components/ui/Skeleton';

interface PausaItem {
  id?:        number;
  ora_inizio: string;
  ora_fine:   string;
}

interface GiornoRow {
  linea_id:             number;
  linea_nome:           string;
  t1_inizio:            string | null;
  t1_fine:              string | null;
  t2_inizio:            string | null;
  t2_fine:              string | null;
  quantita_giornaliera: number | null;
  pause:                PausaItem[];
}

interface RowState {
  t1_inizio:            string;
  t1_fine:              string;
  t2_inizio:            string;
  t2_fine:              string;
  quantita_giornaliera: string;
  pause:                PausaItem[];
  dirty:   boolean;
  saving:  boolean;
  saved:   boolean;
}

const MAX_PAUSE = 3;

function timeToMin(t: string) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function cycleLabel(
  t1i: string, t1f: string,
  t2i: string, t2f: string,
  pause: PausaItem[],
  qta: number,
): string {
  if (qta <= 0) return '';
  let turnoMin = 0;
  if (t1i && t1f) turnoMin += Math.max(0, timeToMin(t1f) - timeToMin(t1i));
  if (t2i && t2f) turnoMin += Math.max(0, timeToMin(t2f) - timeToMin(t2i));
  if (turnoMin <= 0) return '';

  const pauseMin = pause.reduce((acc, p) => {
    if (!p.ora_inizio || !p.ora_fine) return acc;
    return acc + Math.max(0, timeToMin(p.ora_fine) - timeToMin(p.ora_inizio));
  }, 0);

  const netto = turnoMin - pauseMin;
  if (netto <= 0) return '';
  const sec = Math.round((netto * 60) / qta);
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')} /pz`;
}

function emptyRow(): RowState {
  return {
    t1_inizio: '06:00', t1_fine: '14:00',
    t2_inizio: '', t2_fine: '',
    quantita_giornaliera: '',
    pause: [],
    dirty: false, saving: false, saved: false,
  };
}

function rowFromApi(r: GiornoRow): RowState {
  return {
    t1_inizio:            r.t1_inizio ?? '06:00',
    t1_fine:              r.t1_fine   ?? '14:00',
    t2_inizio:            r.t2_inizio ?? '',
    t2_fine:              r.t2_fine   ?? '',
    quantita_giornaliera: r.quantita_giornaliera != null ? String(r.quantita_giornaliera) : '',
    pause:                r.pause.map(p => ({ id: p.id, ora_inizio: p.ora_inizio, ora_fine: p.ora_fine })),
    dirty: false, saving: false, saved: false,
  };
}

export default function TurniCalendarioPage() {
  const toast = useToast();
  const [date,    setDate]    = useState(today());
  const [rows,    setRows]    = useState<GiornoRow[]>([]);
  const [cells,   setCells]   = useState<Record<number, RowState>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => { document.title = 'Turni — STR'; }, []);

  const fetchAll = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const [data, defaults] = await Promise.all([
        api.get<GiornoRow[]>(`/api/monitor/giorno/${d}`),
        api.get<Record<number, {
          t1_inizio: string | null; t1_fine: string | null;
          t2_inizio: string | null; t2_fine: string | null;
          quantita_giornaliera: number | null;
          pause: Array<{ ora_inizio: string; ora_fine: string }>;
        }>>(`/api/monitor/defaults-for-date/${d}`).catch(() => ({} as Record<number, never>)),
      ]);
      setRows(data);
      const next: Record<number, RowState> = {};
      for (const r of data) {
        const hasData = r.t1_inizio || r.quantita_giornaliera;
        if (!hasData && defaults[r.linea_id]) {
          const def = defaults[r.linea_id];
          next[r.linea_id] = {
            t1_inizio:            def.t1_inizio ?? '',
            t1_fine:              def.t1_fine   ?? '',
            t2_inizio:            def.t2_inizio ?? '',
            t2_fine:              def.t2_fine   ?? '',
            quantita_giornaliera: def.quantita_giornaliera != null ? String(def.quantita_giornaliera) : '',
            pause:                (def.pause ?? []).map(p => ({ ora_inizio: p.ora_inizio, ora_fine: p.ora_fine })),
            dirty: true, saving: false, saved: false,
          };
        } else {
          next[r.linea_id] = rowFromApi(r);
        }
      }
      setCells(next);
    } catch {
      // keep existing data on error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(date); }, [date, fetchAll]);

  function setCell(lineaId: number, patch: Partial<RowState>) {
    setCells(prev => ({
      ...prev,
      [lineaId]: { ...prev[lineaId], ...patch, dirty: true, saved: false },
    }));
  }

  function updatePausa(lineaId: number, idx: number, field: 'ora_inizio' | 'ora_fine', val: string) {
    setCells(prev => {
      const c = prev[lineaId];
      const pause = c.pause.map((p, i) => i === idx ? { ...p, [field]: val } : p);
      return { ...prev, [lineaId]: { ...c, pause, dirty: true, saved: false } };
    });
  }

  function addPausa(lineaId: number) {
    setCells(prev => {
      const c = prev[lineaId];
      if (c.pause.length >= MAX_PAUSE) return prev;
      return { ...prev, [lineaId]: { ...c, pause: [...c.pause, { ora_inizio: '10:00', ora_fine: '10:15' }], dirty: true, saved: false } };
    });
  }

  function removePausa(lineaId: number, idx: number) {
    setCells(prev => {
      const c = prev[lineaId];
      const pause = c.pause.filter((_, i) => i !== idx);
      return { ...prev, [lineaId]: { ...c, pause, dirty: true, saved: false } };
    });
  }

  function validateRow(c: RowState): string | null {
    if (c.t1_inizio && c.t1_fine && c.t1_inizio >= c.t1_fine) return 'T1: l\'orario di fine deve essere dopo l\'inizio';
    if (c.t2_inizio && c.t2_fine && c.t2_inizio >= c.t2_fine) return 'T2: l\'orario di fine deve essere dopo l\'inizio';
    for (const p of c.pause) {
      if (p.ora_inizio && p.ora_fine && p.ora_inizio >= p.ora_fine) return 'Una pausa ha l\'orario di fine prima dell\'inizio';
    }
    return null;
  }

  async function saveRow(lineaId: number) {
    const c = cells[lineaId];
    const err = validateRow(c);
    if (err) { toast.error(err); return; }
    setCells(prev => ({ ...prev, [lineaId]: { ...prev[lineaId], saving: true } }));
    try {
      await api.put(`/api/monitor/linee/${lineaId}/giorno`, {
        data:                 date,
        t1_inizio:            c.t1_inizio || null,
        t1_fine:              c.t1_fine   || null,
        t2_inizio:            c.t2_inizio || null,
        t2_fine:              c.t2_fine   || null,
        quantita_giornaliera: c.quantita_giornaliera ? parseInt(c.quantita_giornaliera, 10) : null,
        pause:                c.pause.filter(p => p.ora_inizio && p.ora_fine),
      });
      setCells(prev => ({ ...prev, [lineaId]: { ...prev[lineaId], saving: false, dirty: false, saved: true } }));
      setTimeout(() => setCells(prev => ({ ...prev, [lineaId]: { ...prev[lineaId], saved: false } })), 2000);
    } catch {
      toast.error('Errore durante il salvataggio');
      setCells(prev => ({ ...prev, [lineaId]: { ...prev[lineaId], saving: false } }));
    }
  }

  async function clearRow(lineaId: number) {
    const nome = rows.find(r => r.linea_id === lineaId)?.linea_nome ?? 'questa linea';
    if (!confirm(`Azzerare tutti i dati di ${nome} per ${fmtDate(date)}?`)) return;
    try {
      await api.put(`/api/monitor/linee/${lineaId}/giorno`, {
        data: date, t1_inizio: null, t1_fine: null, t2_inizio: null, t2_fine: null,
        quantita_giornaliera: null, pause: [],
      });
      setCells(prev => ({ ...prev, [lineaId]: emptyRow() }));
      toast.success('Dati azzerati');
    } catch {
      toast.error('Errore durante l\'azzeramento');
    }
  }

  async function copyFromYesterday() {
    const prev = addDays(date, -1);
    const data = await api.get<GiornoRow[]>(`/api/monitor/giorno/${prev}`).catch(() => [] as GiornoRow[]);
    const hasSomething = data.some(r => r.t1_inizio || r.quantita_giornaliera);
    if (!hasSomething) { toast.info('Nessun dato per il giorno precedente'); return; }
    setCells(cur => {
      const next = { ...cur };
      for (const r of data) {
        if (next[r.linea_id]) {
          next[r.linea_id] = {
            ...rowFromApi(r),
            dirty: true, saved: false, saving: false,
          };
        }
      }
      return next;
    });
  }

  async function saveAll() {
    const dirtyIds = rows.map(r => r.linea_id).filter(id => cells[id]?.dirty);
    await Promise.all(dirtyIds.map(id => saveRow(id)));
    toast.success('Tutte le modifiche salvate');
  }

  const hasDirty = rows.some(r => cells[r.linea_id]?.dirty);

  // Input style helpers
  const inp = 'border border-gray-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400';
  const timeInp = `${inp} w-20`;
  const numInp  = `${inp} w-20`;

  return (
    <div>
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Turni — Vista giornaliera</h1>
          <p className="text-sm text-gray-500 mt-0.5">Gestisci turni, quantità e pause per tutte le linee</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setDate(d => addDays(d, -1))} className="btn-secondary px-3">‹</button>
          <input
            type="date"
            className="input"
            value={date}
            onChange={e => setDate(e.target.value)}
          />
          <button onClick={() => setDate(d => addDays(d, 1))} className="btn-secondary px-3">›</button>
          <button onClick={() => setDate(today())} className="btn-secondary text-sm">Oggi</button>
          <button onClick={copyFromYesterday} className="btn-secondary text-sm">Copia da ieri</button>
          {hasDirty && (
            <button onClick={saveAll} className="btn-primary text-sm">Salva tutte</button>
          )}
        </div>
      </div>

      {/* ── Table ── */}
      {loading && <PageLoader />}
      <div className={`bg-white rounded-xl border border-gray-200 overflow-x-auto ${loading ? 'hidden' : ''}`}>
        <table className="text-sm border-collapse" style={{ minWidth: 900 }}>
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="py-2.5 px-3 text-left font-medium text-gray-600 w-28 sticky left-0 bg-gray-50 z-10">Linea</th>
              {/* T1 */}
              <th className="py-2.5 px-2 text-center font-medium text-gray-600" colSpan={2}>
                <span className="text-blue-600">T1</span>
              </th>
              {/* T2 */}
              <th className="py-2.5 px-2 text-center font-medium text-gray-600" colSpan={2}>
                <span className="text-indigo-500">T2</span>
              </th>
              {/* Pause */}
              <th className="py-2.5 px-2 text-center font-medium text-gray-600" colSpan={MAX_PAUSE * 2 + 1}>
                Pause
              </th>
              {/* Qty + Ciclo + actions */}
              <th className="py-2.5 px-2 text-left font-medium text-gray-600 w-20">Qtà/g</th>
              <th className="py-2.5 px-2 text-left font-medium text-gray-400 w-24 font-mono text-xs">Ciclo</th>
              <th className="py-2.5 px-2 w-20"></th>
            </tr>
            <tr className="bg-gray-50 border-b border-gray-100 text-xs text-gray-400">
              <th className="sticky left-0 bg-gray-50 z-10"></th>
              <th className="py-1 px-2 font-normal">Inizio</th>
              <th className="py-1 px-2 font-normal">Fine</th>
              <th className="py-1 px-2 font-normal">Inizio</th>
              <th className="py-1 px-2 font-normal">Fine</th>
              {Array.from({ length: MAX_PAUSE }).map((_, i) => (
                <React.Fragment key={i}>
                  <th className="py-1 px-2 font-normal">P{i + 1} in</th>
                  <th className="py-1 px-2 font-normal">P{i + 1} fin</th>
                </React.Fragment>
              ))}
              <th className="py-1 px-2 font-normal"></th>{/* + pausa btn */}
              <th></th>
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const c = cells[row.linea_id];
              if (!c) return null;
              const qta = parseInt(c.quantita_giornaliera, 10) || 0;
              const cycle = cycleLabel(c.t1_inizio, c.t1_fine, c.t2_inizio, c.t2_fine, c.pause, qta);
              const isConfigured = !c.dirty && (c.t1_inizio || c.quantita_giornaliera);
              return (
                <tr
                  key={row.linea_id}
                  className={`border-b border-gray-100 ${i % 2 === 0 ? '' : 'bg-gray-50/40'} ${c.dirty ? 'bg-blue-50' : ''}`}
                >
                  {/* Linea name */}
                  <td className="py-2 px-3 font-semibold text-gray-800 sticky left-0 bg-inherit z-10">
                    {row.linea_nome}
                  </td>

                  {/* T1 */}
                  <td className="py-1 px-1.5">
                    <input type="time" className={timeInp} value={c.t1_inizio} disabled={c.saving}
                      onChange={e => setCell(row.linea_id, { t1_inizio: e.target.value })} />
                  </td>
                  <td className="py-1 px-1.5">
                    <input type="time" className={timeInp} value={c.t1_fine} disabled={c.saving}
                      onChange={e => setCell(row.linea_id, { t1_fine: e.target.value })} />
                  </td>

                  {/* T2 */}
                  <td className="py-1 px-1.5">
                    <input type="time" className={`${timeInp} text-indigo-600`} value={c.t2_inizio} disabled={c.saving}
                      onChange={e => setCell(row.linea_id, { t2_inizio: e.target.value })} />
                  </td>
                  <td className="py-1 px-1.5">
                    <input type="time" className={`${timeInp} text-indigo-600`} value={c.t2_fine} disabled={c.saving}
                      onChange={e => setCell(row.linea_id, { t2_fine: e.target.value })} />
                  </td>

                  {/* Pause slots */}
                  {Array.from({ length: MAX_PAUSE }).map((_, pi) => {
                    const p = c.pause[pi];
                    return (
                      <React.Fragment key={pi}>
                        <td className="py-1 px-1">
                          {p ? (
                            <input type="time" className={`${timeInp} text-orange-600`} value={p.ora_inizio}
                              onChange={e => updatePausa(row.linea_id, pi, 'ora_inizio', e.target.value)} />
                          ) : <span className="text-gray-200 text-xs px-2">–</span>}
                        </td>
                        <td className="py-1 px-1">
                          {p ? (
                            <div className="flex items-center gap-0.5">
                              <input type="time" className={`${timeInp} text-orange-600`} value={p.ora_fine}
                                onChange={e => updatePausa(row.linea_id, pi, 'ora_fine', e.target.value)} />
                              <button onClick={() => removePausa(row.linea_id, pi)}
                                className="text-red-300 hover:text-red-500 text-xs leading-none px-0.5" title="Rimuovi pausa">✕</button>
                            </div>
                          ) : <span className="text-gray-200 text-xs px-2">–</span>}
                        </td>
                      </React.Fragment>
                    );
                  })}

                  {/* + Pausa button */}
                  <td className="py-1 px-1">
                    {c.pause.length < MAX_PAUSE && (
                      <button onClick={() => addPausa(row.linea_id)}
                        className="text-xs text-orange-400 hover:text-orange-600 border border-orange-200 rounded px-1.5 py-0.5 whitespace-nowrap">
                        + P
                      </button>
                    )}
                  </td>

                  {/* Qtà giorno */}
                  <td className="py-1 px-1.5">
                    <input
                      type="number" min={1}
                      className={numInp}
                      placeholder="es. 50"
                      value={c.quantita_giornaliera}
                      onChange={e => setCell(row.linea_id, { quantita_giornaliera: e.target.value })}
                      onKeyDown={e => { if (e.key === 'Enter') saveRow(row.linea_id); }}
                    />
                  </td>

                  {/* Ciclo */}
                  <td className="py-1 px-2 text-gray-400 text-xs font-mono whitespace-nowrap">
                    {cycle || '–'}
                  </td>

                  {/* Actions */}
                  <td className="py-1 px-2">
                    <div className="flex gap-1 items-center justify-end">
                      {c.saved && <span className="text-green-600 text-xs">✓</span>}
                      {c.dirty && (
                        <button
                          onClick={() => saveRow(row.linea_id)}
                          disabled={c.saving}
                          className="btn-primary text-xs px-2 py-1"
                        >
                          {c.saving ? '...' : 'Salva'}
                        </button>
                      )}
                      {isConfigured && (
                        <button
                          onClick={() => clearRow(row.linea_id)}
                          className="text-xs text-red-400 hover:text-red-600 px-1"
                          title="Azzera giorno"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={20} className="py-8 text-center text-gray-400">Nessuna linea configurata</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-gray-400">
        {fmtDate(date)} — Le righe in blu hanno modifiche non salvate. Premi Invio o «Salva» per confermare.
        T2 opzionale. Fino a {MAX_PAUSE} pause per linea.
      </p>
    </div>
  );
}

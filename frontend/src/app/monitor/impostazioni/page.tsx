'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { Skeleton } from '@/components/ui/Skeleton';
import type { MonitorLinea, MonitorSoglie, MonitorCombo } from '@/types';

// ─── Componente principale ────────────────────────────────────────────────────

export default function MonitorImpostazioniPage() {
  const toast = useToast();
  const [linee, setLinee] = useState<MonitorLinea[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [formLinea, setFormLinea] = useState({ nome: '', fase: '' });
  const [savingLinea, setSavingLinea] = useState(false);

  useEffect(() => { document.title = 'Impostazioni Andon — STR'; }, []);
  useEffect(() => { fetchLinee(); }, []);

  async function fetchLinee() {
    setLoading(true);
    try {
      const data = await api.get<MonitorLinea[]>('/api/monitor/linee');
      setLinee(data);
    } catch {
      toast.error('Errore caricamento linee');
    } finally {
      setLoading(false);
    }
  }

  async function handleAddLinea(e: React.FormEvent) {
    e.preventDefault();
    setSavingLinea(true);
    try {
      await api.post('/api/monitor/linee', formLinea);
      setFormLinea({ nome: '', fase: '' });
      await fetchLinee();
      toast.success('Linea aggiunta');
    } catch {
      toast.error('Errore durante il salvataggio');
    } finally {
      setSavingLinea(false);
    }
  }

  async function handleDeleteLinea(id: number, nome: string) {
    if (!confirm(`Eliminare definitivamente la linea "${nome}"?\nVerranno rimossi anche tutti i turni, pause e configurazioni associate.`)) return;
    try {
      await api.delete(`/api/monitor/linee/${id}`);
      if (selectedId === id) setSelectedId(null);
      await fetchLinee();
      toast.success(`Linea "${nome}" eliminata`);
    } catch {
      toast.error('Errore durante l\'eliminazione');
    }
  }

  const selected = linee.find(l => l.id === selectedId) ?? null;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Impostazioni Andon</h1>
          <p className="text-sm text-gray-500 mt-0.5">Gestisci linee, modelli e soglie colore</p>
        </div>
        <Link href="/monitor/turni" className="btn-primary text-sm">Vista turni per giorno</Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Colonna sinistra ── */}
        <div className="space-y-4">
          <div className="card">
            <h2 className="text-base font-semibold text-gray-700 mb-4">Nuova linea</h2>
            <form onSubmit={handleAddLinea} className="space-y-3">
              <div>
                <label className="label">Nome linea</label>
                <input
                  className="input w-full"
                  placeholder="es. F171VS"
                  value={formLinea.nome}
                  onChange={e => setFormLinea(p => ({ ...p, nome: e.target.value }))}
                  disabled={savingLinea}
                  required
                />
              </div>
              <div>
                <label className="label">Fase</label>
                <input
                  className="input w-full"
                  placeholder="es. MONTAGGIO"
                  value={formLinea.fase}
                  onChange={e => setFormLinea(p => ({ ...p, fase: e.target.value }))}
                  disabled={savingLinea}
                  required
                />
              </div>
              <button
                type="submit"
                className="btn-primary w-full"
                disabled={savingLinea || !formLinea.nome.trim() || !formLinea.fase.trim()}
              >
                {savingLinea ? 'Salvataggio...' : 'Aggiungi linea'}
              </button>
            </form>
          </div>

          <div className="card">
            <h2 className="text-base font-semibold text-gray-700 mb-3">Linee configurate</h2>
            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-9 w-full rounded-lg" />)}
              </div>
            ) : linee.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">Nessuna linea ancora</p>
            ) : (
              <ul className="space-y-1">
                {linee.map(linea => (
                  <li key={linea.id}>
                    <button
                      onClick={() => setSelectedId(linea.id === selectedId ? null : linea.id)}
                      className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors flex items-center justify-between ${
                        selectedId === linea.id
                          ? 'bg-blue-50 text-blue-800 font-medium border border-blue-200'
                          : 'hover:bg-gray-50 text-gray-700 border border-transparent'
                      }`}
                    >
                      <span className="font-medium">{linea.nome}</span>
                      <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">
                        Attivo
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* ── Colonna destra ── */}
        <div className="lg:col-span-2 space-y-4">
          {!selected ? (
            <div className="card text-center py-16 text-gray-400 border-dashed">
              <div className="text-4xl mb-3">←</div>
              <p className="font-medium text-gray-500">Seleziona una linea</p>
              <p className="text-sm mt-1">per configurare modelli e soglie colore</p>
            </div>
          ) : (
            <>
              <div className="card">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-gray-800">{selected.nome}</h2>
                    <p className="text-sm text-gray-500 mt-0.5">Fase: {selected.fase}</p>
                  </div>
                  <button
                    onClick={() => handleDeleteLinea(selected.id, selected.nome)}
                    className="text-xs text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Elimina linea
                  </button>
                </div>
              </div>

              <LogoSection lineaId={selected.id} currentLogo={selected.logo} onSaved={fetchLinee} />
              <ComboSection lineaId={selected.id} />
              <SoglieSection lineaId={selected.id} />
              <DefaultiTurniSection lineaId={selected.id} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sezione Logo ─────────────────────────────────────────────────────────────

const BRANDS = [
  { slug: 'ferrari',      label: 'Ferrari',      file: 'ferrari.png'      },
  { slug: 'maserati',     label: 'Maserati',     file: 'maserati.svg'     },
  { slug: 'aston-martin', label: 'Aston Martin', file: 'aston-martin.svg' },
] as const;

type BrandSlug = typeof BRANDS[number]['slug'];

function LogoSection({ lineaId, currentLogo, onSaved }: {
  lineaId: number;
  currentLogo: string | null;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [selected, setSelected] = useState<BrandSlug | null>(
    (currentLogo as BrandSlug) ?? null
  );
  const [saving, setSaving] = useState(false);

  // Sincronizza se cambia la linea selezionata
  useEffect(() => {
    setSelected((currentLogo as BrandSlug) ?? null);
  }, [lineaId, currentLogo]);

  async function handleSave(slug: BrandSlug | null) {
    setSelected(slug);
    setSaving(true);
    try {
      await api.patch(`/api/monitor/linee/${lineaId}`, { logo: slug });
      onSaved();
      toast.success(slug ? `Logo ${slug} salvato` : 'Logo rimosso');
    } catch {
      toast.error('Errore durante il salvataggio del logo');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h3 className="text-base font-semibold text-gray-700 mb-1">Logo marca</h3>
      <p className="text-xs text-gray-500 mb-4">
        Seleziona il logo da mostrare nell&apos;andon sotto il nome della linea.
      </p>

      <div className="flex flex-wrap gap-3 items-end">
        {/* Nessuno */}
        <button
          onClick={() => handleSave(null)}
          disabled={saving}
          className={`flex flex-col items-center gap-2 px-4 py-3 rounded-xl border-2 transition-all ${
            selected === null
              ? 'border-blue-500 bg-blue-50'
              : 'border-gray-200 hover:border-gray-300 bg-white'
          }`}
        >
          <div className="w-20 h-10 flex items-center justify-center text-gray-400 text-xs">
            Nessuno
          </div>
        </button>

        {/* Marche */}
        {BRANDS.map(brand => (
          <button
            key={brand.slug}
            onClick={() => handleSave(brand.slug)}
            disabled={saving}
            className={`flex flex-col items-center gap-2 px-4 py-3 rounded-xl border-2 transition-all ${
              selected === brand.slug
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 hover:border-gray-300 bg-white'
            }`}
          >
            <div className="w-20 h-10 bg-zinc-900 rounded flex items-center justify-center p-1">
              <img
                src={`/brands/${brand.file}`}
                alt={brand.label}
                className="max-h-full max-w-full object-contain"
              />
            </div>
            <span className="text-xs text-gray-600 font-medium">{brand.label}</span>
          </button>
        ))}
      </div>

      {saving && <p className="text-xs text-gray-400 mt-3">Salvataggio...</p>}
    </div>
  );
}

// ─── Sezione Combo ─────────────────────────────────────────────────────────────

function ComboSection({ lineaId }: { lineaId: number }) {
  const toast = useToast();
  const [combos, setCombos] = useState<MonitorCombo[]>([]);
  const [form, setForm] = useState({ modello: '', componente: '' });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchCombos(); }, [lineaId]);

  async function fetchCombos() {
    setLoading(true);
    try {
      const data = await api.get<MonitorCombo[]>(`/api/monitor/linee/${lineaId}/combo`);
      setCombos(data);
    } finally {
      setLoading(false);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/api/monitor/linee/${lineaId}/combo`, form);
      setForm({ modello: '', componente: '' });
      await fetchCombos();
      toast.success('Combinazione aggiunta');
    } catch {
      toast.error('Errore durante il salvataggio');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number, modello: string) {
    if (!confirm(`Eliminare la combinazione "${modello}"?`)) return;
    try {
      await api.delete(`/api/monitor/combo/${id}`);
      await fetchCombos();
      toast.success('Combinazione eliminata');
    } catch {
      toast.error('Errore durante l\'eliminazione');
    }
  }

  return (
    <div className="card">
      <h3 className="text-base font-semibold text-gray-700 mb-1">Modelli / Componenti</h3>
      <p className="text-xs text-gray-500 mb-4">
        Aggiungi le combinazioni Modello–Componente da visualizzare sull&apos;andon di questa linea.
      </p>

      <form onSubmit={handleAdd} className="flex flex-wrap gap-3 items-end mb-4">
        <div>
          <label className="label">Modello</label>
          <input
            className="input"
            placeholder="es. F171"
            value={form.modello}
            onChange={e => setForm(p => ({ ...p, modello: e.target.value }))}
            disabled={saving}
            required
          />
        </div>
        <div>
          <label className="label">Componente</label>
          <input
            className="input"
            placeholder="es. PAR. POST / REAR BUMPER"
            value={form.componente}
            onChange={e => setForm(p => ({ ...p, componente: e.target.value }))}
            disabled={saving}
            required
          />
        </div>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Salvataggio...' : 'Aggiungi'}
        </button>
      </form>

      {loading ? (
        <div className="space-y-2">{[1, 2].map(i => <Skeleton key={i} className="h-8 w-full rounded" />)}</div>
      ) : combos.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-3 bg-gray-50 rounded-lg">Nessuna combinazione configurata</p>
      ) : (
        <ul className="space-y-1.5">
          {combos.map(c => (
            <li key={c.id} className="flex items-center justify-between text-sm bg-gray-50 rounded-lg px-3 py-2">
              <span>
                <span className="font-medium text-gray-800">{c.modello}</span>
                <span className="text-gray-400 mx-2">·</span>
                <span className="text-gray-600">{c.componente}</span>
              </span>
              <button
                onClick={() => handleDelete(c.id, c.modello)}
                className="text-red-400 hover:text-red-600 text-xs px-2 py-0.5 rounded hover:bg-red-50 transition-colors"
              >
                Elimina
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Sezione Turni default ────────────────────────────────────────────────────

const DAY_NAMES = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
const MAX_DEF_PAUSE = 3;

interface TurnoDefaultRow {
  day_of_week:          number;
  t1_inizio:            string | null;
  t1_fine:              string | null;
  t2_inizio:            string | null;
  t2_fine:              string | null;
  quantita_giornaliera: number | null;
  pause:                Array<{ ora_inizio: string; ora_fine: string }>;
}

function DefaultiTurniSection({ lineaId }: { lineaId: number }) {
  const toast = useToast();
  const [rows, setRows] = useState<TurnoDefaultRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.get<TurnoDefaultRow[]>(`/api/monitor/linee/${lineaId}/defaults`)
      .then(data => setRows(data.map(r => ({ ...r, pause: r.pause ?? [] }))))
      .catch(() => toast.error('Errore caricamento turni standard'))
      .finally(() => setLoading(false));
  }, [lineaId]);

  function update(dow: number, patch: Partial<TurnoDefaultRow>) {
    setRows(prev => prev.map(r => r.day_of_week === dow ? { ...r, ...patch } : r));
  }

  function addPausa(dow: number) {
    setRows(prev => prev.map(r => {
      if (r.day_of_week !== dow) return r;
      const pause = r.pause ?? [];
      if (pause.length >= MAX_DEF_PAUSE) return r;
      return { ...r, pause: [...pause, { ora_inizio: '10:00', ora_fine: '10:15' }] };
    }));
  }

  function removePausa(dow: number, idx: number) {
    setRows(prev => prev.map(r => {
      if (r.day_of_week !== dow) return r;
      const pause = (r.pause ?? []).filter((_, i) => i !== idx);
      return { ...r, pause };
    }));
  }

  function updatePausa(dow: number, idx: number, field: 'ora_inizio' | 'ora_fine', val: string) {
    setRows(prev => prev.map(r => {
      if (r.day_of_week !== dow) return r;
      const pause = (r.pause ?? []).map((p, i) => i === idx ? { ...p, [field]: val } : p);
      return { ...r, pause };
    }));
  }

  async function handleSave() {
    setSaving(true); setSaved(false);
    const sliceHHMM = (v: string | null) => v ? v.slice(0, 5) : null;
    const payload = rows.map(r => ({
      ...r,
      t1_inizio: sliceHHMM(r.t1_inizio),
      t1_fine:   sliceHHMM(r.t1_fine),
      t2_inizio: sliceHHMM(r.t2_inizio),
      t2_fine:   sliceHHMM(r.t2_fine),
      pause:     (r.pause ?? []),
    }));
    try {
      await api.put(`/api/monitor/linee/${lineaId}/defaults`, payload);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      toast.success('Turni standard salvati');
    } catch {
      toast.error('Errore durante il salvataggio');
    } finally {
      setSaving(false);
    }
  }

  const inp = 'border border-gray-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400';
  const timeInp = `${inp} w-20`;
  const numInp  = `${inp} w-20`;

  return (
    <div className="card">
      <h3 className="text-base font-semibold text-gray-700 mb-1">Turni standard</h3>
      <p className="text-xs text-gray-500 mb-4">
        Orari predefiniti per giorno della settimana. Applicati automaticamente quando si apre un giorno senza dati nella vista turni.
      </p>

      {loading ? (
        <p className="text-sm text-gray-400">Caricamento...</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse" style={{ minWidth: 700 }}>
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-gray-500">
                <th className="py-2 px-2 text-left w-24">Giorno</th>
                <th className="py-2 px-2 text-center" colSpan={2}><span className="text-blue-600">T1</span></th>
                <th className="py-2 px-2 text-center" colSpan={2}><span className="text-indigo-500">T2</span></th>
                <th className="py-2 px-2 text-center" colSpan={MAX_DEF_PAUSE * 2 + 1}>Pause</th>
                <th className="py-2 px-2 text-left w-20">Qtà/g</th>
              </tr>
              <tr className="bg-gray-50 border-b border-gray-100 text-gray-400">
                <th></th>
                <th className="py-1 px-2 font-normal">Inizio</th>
                <th className="py-1 px-2 font-normal">Fine</th>
                <th className="py-1 px-2 font-normal">Inizio</th>
                <th className="py-1 px-2 font-normal">Fine</th>
                {Array.from({ length: MAX_DEF_PAUSE }).map((_, i) => (
                  <th key={i} className="py-1 px-1 font-normal" colSpan={2}>P{i + 1}</th>
                ))}
                <th></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.day_of_week} className="border-b border-gray-100 hover:bg-gray-50/50">
                  <td className="py-1.5 px-2 font-medium text-gray-700">{DAY_NAMES[r.day_of_week]}</td>
                  <td className="py-1 px-1">
                    <input type="time" className={timeInp} value={r.t1_inizio ?? ''}
                      onChange={e => update(r.day_of_week, { t1_inizio: e.target.value || null })} />
                  </td>
                  <td className="py-1 px-1">
                    <input type="time" className={timeInp} value={r.t1_fine ?? ''}
                      onChange={e => update(r.day_of_week, { t1_fine: e.target.value || null })} />
                  </td>
                  <td className="py-1 px-1">
                    <input type="time" className={`${timeInp} text-indigo-600`} value={r.t2_inizio ?? ''}
                      onChange={e => update(r.day_of_week, { t2_inizio: e.target.value || null })} />
                  </td>
                  <td className="py-1 px-1">
                    <input type="time" className={`${timeInp} text-indigo-600`} value={r.t2_fine ?? ''}
                      onChange={e => update(r.day_of_week, { t2_fine: e.target.value || null })} />
                  </td>
                  {Array.from({ length: MAX_DEF_PAUSE }).map((_, pi) => {
                    const pauseArr = r.pause ?? [];
                    const p = pauseArr[pi];
                    return (
                      <td key={pi} className="py-1 px-1" colSpan={2}>
                        {p ? (
                          <div className="flex items-center gap-0.5">
                            <input type="time" className={`${timeInp} text-orange-600`} value={p.ora_inizio}
                              onChange={e => updatePausa(r.day_of_week, pi, 'ora_inizio', e.target.value)} />
                            <input type="time" className={`${timeInp} text-orange-600`} value={p.ora_fine}
                              onChange={e => updatePausa(r.day_of_week, pi, 'ora_fine', e.target.value)} />
                            <button onClick={() => removePausa(r.day_of_week, pi)}
                              className="text-red-300 hover:text-red-500 leading-none px-0.5" title="Rimuovi">✕</button>
                          </div>
                        ) : (
                          pauseArr.length === pi && pauseArr.length < MAX_DEF_PAUSE ? (
                            <button onClick={() => addPausa(r.day_of_week)}
                              className="text-orange-400 hover:text-orange-600 border border-orange-200 rounded px-1.5 py-0.5 whitespace-nowrap">
                              + P
                            </button>
                          ) : <span className="text-gray-200 px-2">–</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="py-1 px-1">
                    <input type="number" min={1} className={numInp} placeholder="es. 50"
                      value={r.quantita_giornaliera ?? ''}
                      onChange={e => update(r.day_of_week, {
                        quantita_giornaliera: e.target.value ? parseInt(e.target.value, 10) : null,
                      })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 flex items-center gap-3">
        <button onClick={handleSave} disabled={saving || loading} className="btn-primary text-sm">
          {saving ? 'Salvataggio...' : 'Salva turni standard'}
        </button>
        {saved && <span className="text-sm text-green-600">✓ Salvato</span>}
      </div>
    </div>
  );
}

// ─── Sezione Soglie colore ────────────────────────────────────────────────────

function SoglieSection({ lineaId }: { lineaId: number }) {
  const toast = useToast();
  const [form, setForm] = useState({ soglia_giallo: 50, soglia_rosso: 20 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<MonitorSoglie>(`/api/monitor/linee/${lineaId}/soglie`).then(data => {
      setForm({ soglia_giallo: data.soglia_giallo, soglia_rosso: data.soglia_rosso });
    });
  }, [lineaId]);

  function validate(): string {
    if (form.soglia_giallo <= form.soglia_rosso) return 'La soglia giallo deve essere maggiore della soglia rosso';
    if (form.soglia_giallo >= 100) return 'La soglia giallo deve essere inferiore a 100%';
    return '';
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const err = validate();
    if (err) { setError(err); return; }
    setError('');
    setSaving(true);
    try {
      await api.put<MonitorSoglie>(`/api/monitor/linee/${lineaId}/soglie`, form);
      toast.success('Soglie salvate');
    } catch {
      toast.error('Errore durante il salvataggio');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h3 className="text-base font-semibold text-gray-700 mb-1">Soglie colore</h3>
      <p className="text-xs text-gray-500 mb-4">
        Percentuale del tempo ciclo rimanente al cambio colore. Verde → Giallo → Rosso.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{error}</div>
      )}

      <form onSubmit={handleSave} className="flex flex-wrap gap-4 items-end">
        <div>
          <label className="label">Giallo sotto (% ciclo)</label>
          <input
            type="number" className="input w-28" min={1} max={99}
            value={form.soglia_giallo}
            onChange={e => { setError(''); setForm(p => ({ ...p, soglia_giallo: parseInt(e.target.value) || 0 })); }}
            disabled={saving} required
          />
        </div>
        <div>
          <label className="label">Rosso sotto (% ciclo)</label>
          <input
            type="number" className="input w-28" min={1} max={99}
            value={form.soglia_rosso}
            onChange={e => { setError(''); setForm(p => ({ ...p, soglia_rosso: parseInt(e.target.value) || 0 })); }}
            disabled={saving} required
          />
        </div>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Salvataggio...' : 'Salva soglie'}
        </button>
      </form>

      <div className="mt-4 flex flex-wrap gap-4 text-sm">
        <span className="flex items-center gap-2">
          <span className="w-3.5 h-3.5 rounded-full bg-green-500 inline-block" />
          Verde: &gt; {form.soglia_giallo}%
        </span>
        <span className="flex items-center gap-2">
          <span className="w-3.5 h-3.5 rounded-full bg-yellow-400 inline-block" />
          Giallo: {form.soglia_rosso}–{form.soglia_giallo}%
        </span>
        <span className="flex items-center gap-2">
          <span className="w-3.5 h-3.5 rounded-full bg-red-500 inline-block" />
          Rosso: &lt; {form.soglia_rosso}%
        </span>
      </div>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { Skeleton } from '@/components/ui/Skeleton';
import { ExcelImportButton } from '@/app/produzione/_components/ExcelImportButton';

// Regole di prezzo: una riga = un articolo + fino a 3 parole da cercare in ordine + prezzo.
// Se una parola non si trova la regola non fa nulla; se si trovano tutte, il prezzo si somma.

interface Passo { cerca: string[]; finestra: number | null }
interface Regola { id: number; nome: string; attiva: boolean; article_code: string; prezzo: number; passi: Passo[] }
interface Bozza { articolo: string; c1: string; c2: string; c3: string; distanza: string; prezzo: string; note: string }

const VUOTA: Bozza = { articolo: '', c1: '', c2: '', c3: '', distanza: '', prezzo: '', note: '' };
const eur = (n: number) => n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const paroleDa = (t: string) => t.split(',').map(s => s.trim()).filter(Boolean);
const tutti = (c: string) => c === '*';

function bozzaDa(r: Regola): Bozza {
  const celle = r.passi.map(p => p.cerca.join(', '));
  const dist = r.passi.slice(1).find(p => p.finestra != null)?.finestra;
  return {
    articolo: r.article_code, c1: celle[0] ?? '', c2: celle[1] ?? '', c3: celle[2] ?? '',
    distanza: dist != null ? String(dist) : '', prezzo: String(r.prezzo), note: r.nome,
  };
}

/** Corpo da inviare, o un messaggio d'errore. Le colonne vuote in mezzo si compattano. */
function corpoDa(b: Bozza, attiva: boolean): { body: Omit<Regola, 'id'> } | { errore: string } {
  const art = b.articolo.trim();
  if (!art) return { errore: 'Indica l’articolo (* = tutti)' };
  const prezzo = Number(b.prezzo.replace(',', '.'));
  if (b.prezzo.trim() === '' || !Number.isFinite(prezzo)) return { errore: 'Indica un prezzo valido' };
  const d = parseInt(b.distanza, 10);
  const finestra = Number.isInteger(d) && d > 0 ? d : null;
  const passi = [b.c1, b.c2, b.c3].map(paroleDa).filter(p => p.length > 0).map((cerca, i) => ({ cerca, finestra: i === 0 ? null : finestra }));
  return { body: { nome: b.note.trim(), attiva, article_code: /^(tutti|tutte)$/i.test(art) ? '*' : art, prezzo, passi } };
}

export function TabRegole({ manage }: { manage: boolean }) {
  const toast = useToast();
  const [regole, setRegole] = useState<Regola[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [nuova, setNuova] = useState<Bozza>(VUOTA);
  const [edit, setEdit] = useState<{ id: number; b: Bozza } | null>(null);
  const [fArt, setFArt] = useState('');
  const [fParola, setFParola] = useState('');
  const [fNote, setFNote] = useState('');

  const load = useCallback(() => {
    api.get<Regola[]>('/api/fatturazione/regole').then(setRegole).catch(e => toast.error(errMsg(e))).finally(() => setLoading(false));
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  async function esegui(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    try { await fn(); if (ok) toast.success(ok); load(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  }

  function aggiungi() {
    const c = corpoDa(nuova, true);
    if ('errore' in c) { toast.error(c.errore); return; }
    void esegui(async () => { await api.post('/api/fatturazione/regole', c.body); setNuova(b => ({ ...VUOTA, articolo: b.articolo })); }, 'Regola aggiunta');
  }

  function salvaRiga(r: Regola) {
    if (!edit) return;
    const c = corpoDa(edit.b, r.attiva);
    if ('errore' in c) { toast.error(c.errore); return; }
    void esegui(async () => { await api.put(`/api/fatturazione/regole/${r.id}`, c.body); setEdit(null); }, 'Regola salvata');
  }

  const hasFilter = !!(fArt.trim() || fParola.trim() || fNote.trim());
  const filtrate = useMemo(() => {
    const a = fArt.trim().toUpperCase(), p = fParola.trim().toUpperCase(), n = fNote.trim().toUpperCase();
    return regole.filter(r => {
      if (a && !r.article_code.toUpperCase().includes(a)) return false;
      if (p && !r.passi.some(x => x.cerca.some(w => w.toUpperCase().includes(p)))) return false;
      if (n && !r.nome.toUpperCase().includes(n)) return false;
      return true;
    });
  }, [regole, fArt, fParola, fNote]);

  function eliminaFiltrate() {
    if (!hasFilter || filtrate.length === 0) return;
    if (!confirm(`Eliminare TUTTE le ${filtrate.length} regole che corrispondono ai filtri impostati? L'azione non è reversibile.`)) return;
    void esegui(() => api.post('/api/fatturazione/regole/elimina', { ids: filtrate.map(r => r.id) }), 'Regole eliminate');
  }

  if (loading) return <div className="card space-y-3"><Skeleton className="h-5 w-1/3" /><Skeleton className="h-24 w-full" /></div>;

  const cell = 'input !px-1.5 !py-1 !text-xs';
  const filtro = 'input !px-2.5 !py-1.5 !text-xs font-normal min-w-[6.5rem]';
  const set = (p: Partial<Bozza>) => setNuova(b => ({ ...b, ...p }));
  const setE = (p: Partial<Bozza>) => setEdit(e => (e ? { ...e, b: { ...e.b, ...p } } : e));
  const nd = <span className="text-stone-300">–</span>;

  return (
    <div className="space-y-4">
      {manage && (
        <div className="space-y-3 rounded-card border border-line bg-white p-4">
          <p className="text-xs text-muted">
            Una regola = un articolo + fino a 3 parole da cercare nella descrizione, una dopo l&apos;altra. Se una parola non c&apos;è, la regola non fa nulla; se ci sono tutte, aggiunge il prezzo.
            Parole separate da virgola = alternative; @NOME = gruppo di parole. Articolo * = tutti. Senza parole il prezzo vale sempre per l&apos;articolo.
          </p>
          <div className="grid gap-2 md:grid-cols-4">
            <input className="input" value={nuova.articolo} onChange={e => set({ articolo: e.target.value })} placeholder="Articolo (codice di vendita, * = tutti)" />
            <input className="input" value={nuova.c1} onChange={e => set({ c1: e.target.value })} placeholder="Cerca (es. PPE1)" />
            <input className="input" value={nuova.c2} onChange={e => set({ c2: e.target.value })} placeholder="Poi cerca (es. @COLORI)" />
            <input className="input" value={nuova.c3} onChange={e => set({ c3: e.target.value })} placeholder="Poi cerca (es. OPACO)" />
          </div>
          <div className="grid gap-2 md:grid-cols-4">
            <input className="input" type="number" min={1} value={nuova.distanza} onChange={e => set({ distanza: e.target.value })}
              placeholder="Distanza massima tra le parole (vuoto = ovunque)" title="Quanti caratteri al massimo possono separare una parola dalla precedente" />
            <input className="input" value={nuova.prezzo} onChange={e => set({ prezzo: e.target.value })} placeholder="Prezzo (EUR)" inputMode="decimal" />
            <input className="input md:col-span-2" value={nuova.note} onChange={e => set({ note: e.target.value })} placeholder="Note (facoltative)" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-primary" onClick={aggiungi} disabled={busy}>Aggiungi regola</button>
            <ExcelImportButton endpoint="/api/fatturazione/regole/import-excel" onDone={load}
              label="Carica da Excel (Articolo, Cerca 1, Cerca 2, Cerca 3, Distanza, Prezzo, Note)" />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted">{hasFilter ? `${filtrate.length} di ${regole.length}` : regole.length} regole</span>
        {manage && (
          <button onClick={eliminaFiltrate} disabled={!hasFilter || busy || filtrate.length === 0}
            title={hasFilter ? '' : 'Imposta almeno un filtro per abilitare la cancellazione in blocco'}
            className="btn-secondary !text-danger whitespace-nowrap">
            Elimina tutti i filtrati
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-card bg-white shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-[11px] uppercase tracking-wider text-muted">
              <th className="px-4 py-2.5 text-left font-medium">Articolo</th>
              <th className="px-4 py-2.5 text-left font-medium">Cerca</th>
              <th className="px-4 py-2.5 text-left font-medium">Poi cerca</th>
              <th className="px-4 py-2.5 text-left font-medium">Poi cerca</th>
              <th className="px-4 py-2.5 text-left font-medium">Distanza</th>
              <th className="px-4 py-2.5 text-right font-medium">Prezzo</th>
              <th className="px-4 py-2.5 text-left font-medium">Note</th>
              <th className="px-4 py-2.5 text-center font-medium">Attiva</th>
              <th className="px-4 py-2.5" />
            </tr>
            <tr className="border-b border-line">
              <th className="px-4 pb-2"><input className={filtro} value={fArt} onChange={e => setFArt(e.target.value)} placeholder="Filtra articolo" aria-label="Filtra per articolo" /></th>
              <th className="px-4 pb-2" colSpan={3}><input className={filtro} value={fParola} onChange={e => setFParola(e.target.value)} placeholder="Filtra per parola" aria-label="Filtra per parola cercata" /></th>
              <th className="px-4 pb-2" />
              <th className="px-4 pb-2" />
              <th className="px-4 pb-2"><input className={filtro} value={fNote} onChange={e => setFNote(e.target.value)} placeholder="Filtra note" aria-label="Filtra per note" /></th>
              <th className="px-4 pb-2" />
              <th className="px-4 pb-2" />
            </tr>
          </thead>
          <tbody>
            {filtrate.length === 0 && <tr><td colSpan={9} className="py-6 text-center text-muted">Nessuna regola</td></tr>}
            {filtrate.map(r => {
              if (edit && edit.id === r.id) {
                return (
                  <tr key={r.id} className="border-b border-stone-100 bg-accent-soft">
                    <td className="px-2 py-2"><input className={cell} value={edit.b.articolo} onChange={e => setE({ articolo: e.target.value })} /></td>
                    <td className="px-2 py-2"><input className={cell} value={edit.b.c1} onChange={e => setE({ c1: e.target.value })} /></td>
                    <td className="px-2 py-2"><input className={cell} value={edit.b.c2} onChange={e => setE({ c2: e.target.value })} /></td>
                    <td className="px-2 py-2"><input className={cell} value={edit.b.c3} onChange={e => setE({ c3: e.target.value })} /></td>
                    <td className="px-2 py-2"><input className={cell} type="number" min={1} value={edit.b.distanza} onChange={e => setE({ distanza: e.target.value })} /></td>
                    <td className="px-2 py-2"><input className={`${cell} text-right`} inputMode="decimal" value={edit.b.prezzo} onChange={e => setE({ prezzo: e.target.value })} /></td>
                    <td className="px-2 py-2"><input className={cell} value={edit.b.note} onChange={e => setE({ note: e.target.value })} /></td>
                    <td className="px-4 py-2 text-center"><input type="checkbox" checked={r.attiva} disabled /></td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      <button onClick={() => salvaRiga(r)} disabled={busy} className="btn-primary mr-2 !px-3 !py-1 !text-xs">Salva</button>
                      <button onClick={() => setEdit(null)} className="text-xs text-muted hover:text-ink-700">Annulla</button>
                    </td>
                  </tr>
                );
              }
              const celle = [0, 1, 2].map(i => r.passi[i]);
              return (
                <tr key={r.id} className={`border-b border-stone-100 hover:bg-accent-soft/50 ${r.attiva ? '' : 'opacity-60'}`}>
                  <td className="px-4 py-2 font-mono">{tutti(r.article_code) ? <span className="italic text-muted">tutti</span> : r.article_code}</td>
                  {celle.map((p, i) => <td key={i} className="px-4 py-2 text-muted">{p ? p.cerca.join(', ') : nd}</td>)}
                  <td className="px-4 py-2 text-muted">{r.passi.slice(1).find(p => p.finestra != null)?.finestra ?? nd}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right font-medium">{eur(r.prezzo)}</td>
                  <td className="max-w-[200px] truncate px-4 py-2 text-muted" title={r.nome}>{r.nome || nd}</td>
                  <td className="px-4 py-2 text-center">
                    <input type="checkbox" checked={r.attiva} disabled={!manage || busy} aria-label="Regola attiva"
                      onChange={() => void esegui(() => api.put(`/api/fatturazione/regole/${r.id}/attiva`, { attiva: !r.attiva }))} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    {manage && (
                      <>
                        <button onClick={() => setEdit({ id: r.id, b: bozzaDa(r) })} className="mr-3 text-xs text-accent-ink">Modifica</button>
                        <button onClick={() => { if (confirm('Eliminare questa regola?')) void esegui(() => api.delete(`/api/fatturazione/regole/${r.id}`)); }} className="text-xs text-danger">Elimina</button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

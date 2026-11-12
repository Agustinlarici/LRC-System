'use client';

import { useCallback, useEffect, useState } from 'react';
import { Errore } from '@/components/ferrari/Comuni';
import { IconaOk } from '@/components/ferrari/Icone';
import { sopApi, type RegolaSop } from '@/lib/ferrari-sop';

interface Bozza { colonna: string; tipo: RegolaSop['tipo']; sigle: string; base: string; unisci: string; gamma: string; extra: string; mappa: string }

const righe = (t: string) => t.split(/[\n,;]+/).map(x => x.trim()).filter(Boolean);
const daRegola = (r: RegolaSop): Bozza => ({
  colonna: r.colonna, tipo: r.tipo,
  sigle: r.tipo === 'sigle' ? r.sigle.join(', ') : '', base: r.tipo === 'sigle' ? r.base : '', unisci: r.tipo === 'sigle' ? r.unisci : '/',
  gamma: r.tipo === 'colore' ? r.gamma.join(', ') : 'PNCC', extra: r.tipo === 'colore' ? r.extra : 'EXTRACAMPIONARIO',
  mappa: r.tipo === 'mercato' ? Object.entries(r.mappa).map(([k, v]) => `${k} = ${v}`).join('\n') : '',
});
const aRegola = (b: Bozza): RegolaSop => {
  const colonna = b.colonna.trim();
  if (b.tipo === 'colore') return { colonna, tipo: 'colore', gamma: righe(b.gamma), extra: b.extra.trim() };
  if (b.tipo === 'mercato') {
    const mappa: Record<string, string> = {};
    for (const riga of b.mappa.split('\n')) { const [k, ...v] = riga.split('='); if (k?.trim() && v.length) mappa[k.trim()] = v.join('=').trim(); }
    return { colonna, tipo: 'mercato', mappa };
  }
  return { colonna, tipo: 'sigle', sigle: righe(b.sigle), base: b.base.trim(), unisci: b.unisci || '/' };
};
const nuova = (colonna: string): Bozza => daRegola({ colonna, tipo: 'sigle', sigle: [], base: '', unisci: '/' });

/** Controllo SOP, scheda Regole: come ricavare ogni colonna del SOP dalla scheda. */
export function SopRegole({ colonneSop, onCambia }: { colonneSop: string[]; onCambia: () => void }) {
  const [bozze, setBozze] = useState<Bozza[] | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [occupato, setOccupato] = useState(false);
  const [salvato, setSalvato] = useState(false);
  const [nuovaCol, setNuovaCol] = useState('');

  const carica = useCallback(async () => {
    try { setBozze((await sopApi.regole()).regole.map(daRegola)); setErrore(null); } catch (e) { setErrore((e as Error).message); }
  }, []);
  useEffect(() => { carica(); }, [carica]);

  async function esegui(f: () => Promise<unknown>) {
    setOccupato(true);
    try { await f(); setErrore(null); } catch (e) { setErrore((e as Error).message); } finally { setOccupato(false); }
  }
  const salva = () => esegui(async () => {
    await sopApi.salvaRegole((bozze ?? []).map(aRegola));
    setSalvato(true); setTimeout(() => setSalvato(false), 2500);
    onCambia();
  });
  const suggerite = () => esegui(async () => { await sopApi.suggerite(); await carica(); onCambia(); });
  const cambia = (i: number, patch: Partial<Bozza>) => setBozze(b => b!.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const aggiungi = () => {
    const c = nuovaCol.trim();
    if (!c || bozze!.some(b => b.colonna.toUpperCase() === c.toUpperCase())) return;
    setBozze(b => [...b!, nuova(c)]); setNuovaCol('');
  };

  if (!bozze) return <Errore messaggio={errore} />;
  const senza = colonneSop.filter(c => !bozze.some(b => b.colonna.toUpperCase() === c.toUpperCase()));
  return (
    <div className="max-w-4xl">
      <p className="mb-3 text-sm text-muted">
        Per ogni colonna del SOP, come ricavarla dalla scheda. <b>Sigle</b>: se la scheda ha una di queste sigle il valore è la sigla (o l&apos;etichetta, se scrivi <code>SURR=SV</code>);
        se non ne ha nessuna, il <b>valore base</b> (es. CODINI = EXAT quando non c&apos;è EXAB). <b>Colore</b>: la riga EXTC e quella sotto. <b>Mercato</b>: traduce il valore di MRKT.
        Le colonne senza regola non si controllano.
      </p>
      <Errore messaggio={errore} />
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-card border border-line bg-white px-4 py-3">
        <input className="input !w-56 !py-1" list="colonne-sop" placeholder="Colonna del SOP" value={nuovaCol} onChange={e => setNuovaCol(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') aggiungi(); }} />
        <datalist id="colonne-sop">{senza.map(c => <option key={c} value={c} />)}</datalist>
        <button className="btn-secondary !py-1" disabled={!nuovaCol.trim()} onClick={aggiungi}>Aggiungi regola</button>
        <button className="btn-secondary !py-1" disabled={occupato} onClick={suggerite} title="Aggiunge le regole suggerite per le colonne che non ne hanno">Aggiungi le regole suggerite</button>
        <span className="ml-auto flex items-center gap-2">
          {salvato && <span className="inline-flex items-center gap-1 text-sm text-success"><IconaOk /> Salvato</span>}
          <button className="btn-primary !py-1" disabled={occupato} onClick={salva}>Salva le regole</button>
        </span>
      </div>
      {senza.length > 0 && <p className="mb-3 text-xs text-muted">Colonne del SOP senza regola: {senza.join(', ')}</p>}

      <div className="space-y-3">
        {bozze.map((b, i) => (
          <div key={`${b.colonna}-${i}`} className="rounded-card border border-line bg-white px-4 py-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <input className="input !w-48 !py-1 font-semibold" value={b.colonna} aria-label="Colonna del SOP" onChange={e => cambia(i, { colonna: e.target.value })} />
              <select className="input !w-auto !py-1" value={b.tipo} aria-label="Tipo di regola" onChange={e => cambia(i, { tipo: e.target.value as Bozza['tipo'] })}>
                <option value="sigle">Sigle e valore base</option><option value="colore">Colore (EXTC e riga sotto)</option><option value="mercato">Mercato (MRKT)</option>
              </select>
              <button className="btn-secondary ml-auto !py-1" onClick={() => setBozze(x => x!.filter((_, j) => j !== i))}>Elimina</button>
            </div>
            {b.tipo === 'sigle' && (
              <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                <textarea className="input w-full font-mono text-xs" rows={Math.min(5, Math.max(2, Math.ceil(b.sigle.length / 80)))} value={b.sigle} placeholder="PACF, SURR=SV…"
                  aria-label="Sigle" onChange={e => cambia(i, { sigle: e.target.value })} />
                <label className="text-xs text-muted">Valore base<input className="input mt-1 !w-32 !py-1" value={b.base} placeholder="(vuoto)" onChange={e => cambia(i, { base: e.target.value })} /></label>
                <label className="text-xs text-muted">Unisci con<input className="input mt-1 !w-16 !py-1" value={b.unisci} maxLength={3} onChange={e => cambia(i, { unisci: e.target.value })} /></label>
              </div>
            )}
            {b.tipo === 'colore' && (
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-xs text-muted">Sigle di gamma (se sono sotto EXTC, il colore è il loro valore)<input className="input mt-1 w-full !py-1 font-mono text-xs" value={b.gamma} onChange={e => cambia(i, { gamma: e.target.value })} /></label>
                <label className="text-xs text-muted">Altrimenti<input className="input mt-1 w-full !py-1" value={b.extra} onChange={e => cambia(i, { extra: e.target.value })} /></label>
              </div>
            )}
            {b.tipo === 'mercato' && (
              <label className="block text-xs text-muted">Una riga per ogni traduzione: VALORE DELLA SCHEDA = VALORE DEL SOP
                <textarea className="input mt-1 w-full font-mono text-xs" rows={Math.min(8, Math.max(3, b.mappa.split('\n').length + 1))} value={b.mappa} placeholder={'GIAPPONE = EUROPA/GIAPPONE\nU.S.A. = USA'} onChange={e => cambia(i, { mappa: e.target.value })} />
              </label>
            )}
          </div>
        ))}
        {bozze.length === 0 && <p className="py-8 text-center text-sm text-muted">Nessuna regola. Parti da quelle suggerite.</p>}
      </div>
    </div>
  );
}

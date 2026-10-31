'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Errore } from '@/components/ferrari/Comuni';
import { IconaChiudi } from '@/components/ferrari/Icone';

interface Elenco {
  noti: { modello: string; schede: number; forma: string }[];
  nuovi: { modello: string; schede: number; forma_nota: boolean | null; simile_a: string | null }[];
  forme: string[];
  alias: { sbagliato: string; giusto: string }[];
}

/** Impostazioni → Modelli: i modelli che esistono, quelli nuovi trovati nelle schede e gli errori di scrittura di un modello. */
export function ImpostazioniModelli({ onCambia }: { onCambia?: () => void }) {
  const [g, setG] = useState<Elenco | null>(null);
  const [nuovo, setNuovo] = useState('');
  const [errore, setErrore] = useState<string | null>(null);

  const carica = useCallback(async () => {
    try {
      const r = await api.get<{ gestione_modelli: Elenco }>('/api/ferrari/impostazioni/sigle');
      setG(r.gestione_modelli);
      setErrore(null);
      onCambia?.();
    } catch (e) { setErrore((e as Error).message); }
  }, [onCambia]);
  useEffect(() => { carica(); }, [carica]);

  async function azione(azione: 'crea' | 'togli' | 'errore', modello: string, giusto?: string) {
    try {
      await api.post('/api/ferrari/modelli', { azione, modello, giusto });
      await carica();
    } catch (e) { setErrore((e as Error).message); }
  }

  async function erroreDi(nome: string, suggerito?: string | null) {
    const giusto = (suggerito || prompt(`${nome} è un errore di scrittura di quale modello? (scrivi quello giusto, es. F171VS)`, '') || '').trim();
    if (!giusto) return;
    if (!confirm(`${nome} diventa ${giusto}: le schede già caricate vengono corrette e le prossime pure. Continuare?`)) return;
    await azione('errore', nome, giusto);
  }

  if (!g) return <Errore messaggio={errore} />;
  return (
    <div className="space-y-3">
      <Errore messaggio={errore} />
      {g.nuovi.length > 0 && (
        <div className="rounded-card border border-amber-300 bg-warning-soft px-4 py-3 text-sm">
          <b>{g.nuovi.length} {g.nuovi.length === 1 ? 'modello nuovo trovato' : 'modelli nuovi trovati'}</b> nelle schede. Vuoi crearli?
          {g.nuovi.length > 1 && <button className="btn-primary !py-0.5 text-xs ml-2" onClick={async () => { for (const n of g.nuovi) await azione('crea', n.modello); }}>Crea tutti</button>}
          <table className="mt-2 w-full"><tbody>
            {g.nuovi.map(n => (
              <tr key={n.modello} className="border-t border-amber-200">
                <td className="py-1 pr-3 font-bold">{n.modello}</td>
                <td className="py-1 pr-3 text-muted">{n.schede} {n.schede === 1 ? 'scheda' : 'schede'}{n.forma_nota === false && <span className="ml-2 text-xs font-semibold text-warning">nome scritto in modo diverso dagli altri</span>}</td>
                <td className="py-1 text-right whitespace-nowrap">
                  <button className="btn-primary !py-0.5 text-xs mr-1" onClick={() => azione('crea', n.modello)}>Crea</button>
                  <button className="btn-secondary !py-0.5 text-xs" onClick={() => erroreDi(n.modello, n.simile_a)}>{n.simile_a ? `È un errore di ${n.simile_a}` : 'È un errore di…'}</button>
                </td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input className="input !w-52 !py-1" placeholder="+ modello (es. F171VS)" value={nuovo} onChange={e => setNuovo(e.target.value)}
          onKeyDown={async e => { if (e.key === 'Enter' && nuovo.trim()) { await azione('crea', nuovo.trim()); setNuovo(''); } }} />
        <button className="btn-secondary !py-1" disabled={!nuovo.trim()} onClick={async () => { await azione('crea', nuovo.trim()); setNuovo(''); }}>Aggiungi modello</button>
      </div>
      <p className="text-xs text-muted">
        {g.forme.length
          ? <>Dai modelli che hai creato ho capito come sono fatti i nomi: <b>{g.forme.join(', ')}</b> (A = lettera, 9 = cifra, per esempio F171VS). Un nome nuovo scritto in modo diverso viene segnalato.</>
          : 'Crea il primo modello: da quelli che crei imparo come sono fatti i nomi e riconosco i prossimi.'}
      </p>
      {g.noti.length > 0 && (
        <table className="w-full max-w-xl text-sm rounded-card border border-line bg-white">
          <thead><tr>{['Modello', 'Schede', 'Formato', ''].map((h, i) => <th key={i} className="px-3 py-2 text-left font-semibold border-b border-line">{h}</th>)}</tr></thead>
          <tbody>
            {g.noti.map(m => (
              <tr key={m.modello} className="border-b border-stone-100">
                <td className="px-3 py-1.5 font-bold">{m.modello}</td><td className="px-3 py-1.5">{m.schede}</td><td className="px-3 py-1.5 text-muted">{m.forma}</td>
                <td className="px-3 py-1.5 text-right"><button className="text-muted hover:text-danger" title="Togli dall'elenco"
                  onClick={() => { if (confirm(`Togliere ${m.modello} dall'elenco? Le schede restano.`)) azione('togli', m.modello); }}><IconaChiudi /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {g.alias.length > 0 && (
        <p className="text-xs text-muted">Errori di scrittura che correggo da solo: {g.alias.map(a => <span key={a.sbagliato} className="mr-1 rounded bg-stone-100 px-1.5">{a.sbagliato} diventa {a.giusto}</span>)}</p>
      )}
    </div>
  );
}

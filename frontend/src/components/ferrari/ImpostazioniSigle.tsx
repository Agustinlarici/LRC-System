'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { Errore } from '@/components/ferrari/Comuni';

type Stato = 'colonna' | 'sub' | 'no' | 'alias' | 'da_decidere';
interface Voce {
  codice: string; nome: string; esempio: string; tutti: Stato | null; alias: string | null;
  stati: Record<string, { stato: Stato; ambito: 'modello' | 'tutti' | null; alias: string | null; sub?: boolean; simile_a?: string | null; padre?: string | null }>;
}
interface Config {
  modelli: { modello: string; schede: number }[];
  sigle: Voce[];
  da_decidere: Record<string, number>;
}

const OPZIONI: [string, string][] = [['colonna', 'Colonna'], ['sub', 'Sotto-sigla'], ['no', 'Ignorata'], ['alias', '= errore di…'], ['reset', 'Chiedi di nuovo']];
const FILTRI = [['tutte', 'Tutte'], ['da', 'Da decidere'], ['colonna', 'In tabella'], ['sub', 'Sotto-sigle'], ['no', 'Ignorate']] as const;
const colore: Record<string, string> = {
  colonna: 'text-green-700 font-semibold', sub: 'text-blue-700 font-semibold', no: 'text-gray-400',
  alias: 'text-amber-700 font-semibold', da_decidere: 'bg-amber-100 text-amber-800 font-semibold',
};

function Scelta({ stato, alias, onScegli }: { stato: Stato | null; alias: string | null; onScegli: (v: string) => void }) {
  return (
    <select className={`input !w-auto !py-0.5 text-xs ${stato ? colore[stato] : 'text-gray-400'}`} value={stato ?? ''} onChange={e => onScegli(e.target.value)}>
      {stato === null && <option value="" disabled>—</option>}
      {stato === 'da_decidere' && <option value="da_decidere" disabled>? da decidere</option>}
      {OPZIONI.map(([v, n]) => <option key={v} value={v}>{n}{v === 'alias' && stato === 'alias' && alias ? ` ${alias}` : ''}</option>)}
    </select>
  );
}

/** Impostazioni → Sigle: per ogni sigla, cosa fa in ogni modello (colonna, sotto-sigla, ignorata, errore di scrittura). */
export function ImpostazioniSigle({ onCambia }: { onCambia?: () => void }) {
  const [c, setC] = useState<Config | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<typeof FILTRI[number][0]>('tutte');
  const [cerca, setCerca] = useState('');
  const [nuovo, setNuovo] = useState('');
  const [tipo, setTipo] = useState('colonna');

  const carica = useCallback(async () => {
    try { setC(await api.get<Config>('/api/ferrari/impostazioni/sigle')); setErrore(null); onCambia?.(); } catch (e) { setErrore((e as Error).message); }
  }, [onCambia]);
  useEffect(() => { carica(); }, [carica]);

  async function imposta(codice: string, stato: string, modelli: string[] | '*') {
    let alias: string | null = null;
    if (stato === 'alias') {
      alias = (prompt('Questo codice è un errore di scrittura di quale sigla?', '') ?? '').trim();
      if (!alias) { await carica(); return; }
    }
    if (modelli === '*' && c?.sigle.find(s => s.codice === codice && Object.values(s.stati).some(x => x.ambito === 'modello'))
      && !confirm('Questa scelta sostituisce quelle fatte per i singoli modelli. Continuare?')) { await carica(); return; }
    try {
      await api.post('/api/ferrari/sigle/imposta', { codice, stato, modelli, alias });
      await carica();
    } catch (e) {
      setErrore((e as Error).message);
      await carica();
    }
  }

  async function inBlocco(modello: string, stato: 'colonna' | 'no') {
    if (!confirm(`${stato === 'colonna' ? 'Mettere TUTTE le sigle da decidere come colonne' : 'Ignorare TUTTE le sigle da decidere'} per ${modello}?`)) return;
    try {
      await api.post('/api/ferrari/sigle/da-decidere', { modello, stato });
      await carica();
    } catch (e) {
      setErrore((e as Error).message);
    }
  }

  const righe = useMemo(() => (c?.sigle ?? []).filter(s => {
    if (cerca && !`${s.codice} ${s.nome}`.toLowerCase().includes(cerca.toLowerCase())) return false;
    const sts = Object.values(s.stati).map(x => x.stato);
    if (filtro === 'da') return sts.includes('da_decidere');
    if (filtro === 'colonna' || filtro === 'sub' || filtro === 'no') return sts.includes(filtro);
    return true;
  }), [c, cerca, filtro]);

  if (!c) return <Errore messaggio={errore} />;
  const conDaDecidere = c.modelli.filter(m => (c.da_decidere[m.modello] ?? 0) > 0);

  return (
    <div className="space-y-3">
      <Errore messaggio={errore} />
      {conDaDecidere.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm">
          <b>Sigle da decidere</b> <span className="text-gray-600">(trovate nelle schede, ancora senza risposta)</span>
          {conDaDecidere.map(m => (
            <div key={m.modello} className="mt-1.5 flex flex-wrap items-center gap-2">
              <b>{m.modello}</b>: {c.da_decidere[m.modello]}
              <button className="btn-primary !py-0.5 text-xs" onClick={() => inBlocco(m.modello, 'colonna')}>Tutte colonna</button>
              <button className="btn-secondary !py-0.5 text-xs" onClick={() => inBlocco(m.modello, 'no')}>Tutte ignorate</button>
            </div>
          ))}
          <p className="mt-1.5 text-xs text-gray-500">Oppure scegli una per una nella tabella (filtro «Da decidere»).</p>
        </div>
      )}
      <p className="text-xs text-gray-500">
        <b>Colonna</b> = compare nella tabella · <b>Sotto-sigla</b> = compare dentro la cella di un&apos;altra voce (es. TLM13 dentro LIVR) · <b>Ignorata</b> = non interessa · <b>= errore di…</b> = è un errore di scrittura di un&apos;altra sigla.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input className="input !w-56 !py-1" placeholder="Cerca sigla…" value={cerca} onChange={e => setCerca(e.target.value)} />
        <select className="input !w-auto !py-1" value={filtro} onChange={e => setFiltro(e.target.value as typeof filtro)}>
          {FILTRI.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
        </select>
        <span className="text-xs text-gray-500">{righe.length} sigle</span>
        <span className="ml-auto" />
        <input className="input !w-52 !py-1" placeholder="+ sigla o parola (es. BIC2)" value={nuovo} onChange={e => setNuovo(e.target.value)} />
        <select className="input !w-auto !py-1" value={tipo} onChange={e => setTipo(e.target.value)}>
          <option value="colonna">Colonna</option><option value="sub">Sotto-sigla</option>
        </select>
        <button className="btn-secondary !py-1" disabled={!nuovo.trim()} onClick={async () => { await imposta(nuovo.trim(), tipo, '*'); setNuovo(''); }}>Aggiungi a tutti i modelli</button>
      </div>
      <div className="max-h-[68vh] overflow-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr>
              {['Sigla', 'Cosa è', 'Tutti i modelli', ...c.modelli.map(m => m.modello), ''].map((h, i) => (
                <th key={i} className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 text-left font-semibold whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {righe.map(s => {
              const da = Object.values(s.stati).some(x => x.stato === 'da_decidere');
              const simile = Object.values(s.stati).map(x => x.simile_a).find(Boolean);
              const padre = Object.values(s.stati).map(x => x.padre).find(Boolean);
              return (
                <tr key={s.codice} className={da ? 'bg-amber-50/60' : ''}>
                  <td className="border-b border-gray-100 px-3 py-1.5 font-bold">{s.codice}</td>
                  <td className="border-b border-gray-100 px-3 py-1.5 max-w-[26rem]" title={s.esempio}>
                    {padre && <span className="mr-1.5 rounded bg-amber-100 px-1.5 text-xs text-amber-800">dentro {padre}</span>}
                    {simile && <span className="mr-1.5 text-xs font-semibold text-amber-700">⚠ simile a {simile}: errore di scrittura?</span>}
                    {s.nome}{s.esempio && <span className="text-xs text-gray-400"> · {s.esempio.slice(0, 70)}</span>}
                  </td>
                  <td className="border-b border-gray-100 px-3 py-1.5"><Scelta stato={s.tutti} alias={s.alias} onScegli={v => imposta(s.codice, v, '*')} /></td>
                  {c.modelli.map(m => {
                    const x = s.stati[m.modello];
                    return (
                      <td key={m.modello} className="border-b border-gray-100 px-3 py-1.5 whitespace-nowrap">
                        <Scelta stato={x?.stato ?? null} alias={x?.alias ?? null} onScegli={v => imposta(s.codice, v, [m.modello])} />
                        {x?.ambito === 'tutti' && <span className="ml-1 text-xs text-gray-400" title="Deciso per tutti i modelli">★</span>}
                      </td>
                    );
                  })}
                  <td className="border-b border-gray-100 px-3 py-1.5 text-right">
                    <button className="text-gray-400 hover:text-red-600" title="Togli questa sigla ovunque (tornerà da decidere)"
                      onClick={() => { if (confirm(`Togliere ${s.codice} da tutti i modelli? Tornerà da decidere se compare ancora nelle schede.`)) imposta(s.codice, 'reset', '*'); }}>✕</button>
                  </td>
                </tr>
              );
            })}
            {righe.length === 0 && <tr><td colSpan={c.modelli.length + 4} className="px-3 py-6 text-center text-gray-400">Nessuna sigla{c.modelli.length === 0 ? ': carica un Excel o leggi la cartella' : ''}.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

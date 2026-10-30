'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Errore } from '@/components/ferrari/Comuni';
import { quando, riassunto, type StatoCartella } from '@/components/ferrari/InfoCartella';
import { IconaOk } from '@/components/ferrari/Icone';

/** Impostazioni → Cartella: dove sono gli Excel, lettura automatica di notte e lettura a mano. */
export function ImpostazioniCartella({ onCambia }: { onCambia?: () => void }) {
  const [st, setSt] = useState<StatoCartella | null>(null);
  const [percorso, setPercorso] = useState('');
  const [auto, setAuto] = useState(false);
  const [ora, setOra] = useState(4);
  const [errore, setErrore] = useState<string | null>(null);
  const [salvato, setSalvato] = useState(false);
  const [aperta, setAperta] = useState<number | null>(null);

  const carica = useCallback(async (init = false) => {
    try {
      const r = await api.get<StatoCartella>('/api/ferrari/cartella');
      setSt(r);
      if (init) { setPercorso(r.config.percorso); setAuto(r.config.auto); setOra(r.config.ora); }
    } catch (e) {
      setErrore((e as Error).message);
    }
  }, []);

  useEffect(() => { carica(true); }, [carica]);
  const inCorso = !!st?.in_corso;
  useEffect(() => {
    if (!inCorso) return;
    const t = setInterval(() => carica(), 2000);
    return () => clearInterval(t);
  }, [inCorso, carica]);
  const ultima = st?.letture[0]?.id;
  useEffect(() => { if (ultima) onCambia?.(); }, [ultima]); // eslint-disable-line react-hooks/exhaustive-deps

  async function salva() {
    try {
      await api.put('/api/ferrari/cartella', { percorso, auto, ora });
      setErrore(null);
      setSalvato(true);
      setTimeout(() => setSalvato(false), 2500);
      await carica(true);
    } catch (e) {
      setErrore((e as Error).message);
    }
  }

  async function leggi() {
    try {
      await api.post('/api/ferrari/cartella/leggi', {});
      setErrore(null);
      await carica();
    } catch (e) {
      setErrore((e as Error).message);
    }
  }

  const cambiata = st && (percorso !== st.config.percorso || auto !== st.config.auto || ora !== st.config.ora);

  return (
    <div className="space-y-4">
      <Errore messaggio={errore} />
      <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
        <p className="text-sm text-gray-500">
          Gli Excel delle schede si mettono in una cartella. Il programma li legge da solo (senza IA) e li aggiunge alla tabella.
          Un file già letto non viene riletto, a meno che non lo modifichi.
        </p>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Cartella degli Excel</label>
          <input className="input" value={percorso} onChange={e => setPercorso(e.target.value)}
            placeholder="\\192.168.1.245\schede\FERRARI" />
          <span className="text-xs text-gray-400">Cartella di rete (\\server\condivisione\cartella). Usa le stesse credenziali delle altre cartelle di rete del programma.</span>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} /> Leggi la cartella ogni notte
          </label>
          <label className={`flex items-center gap-2 text-sm ${auto ? '' : 'opacity-50'}`}>
            alle
            <select className="input !w-auto !py-1" disabled={!auto} value={ora} onChange={e => setOra(Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:20</option>)}
            </select>
          </label>
          <button className="btn-primary ml-auto" disabled={!cambiata} onClick={salva}>{salvato ? <span className="inline-flex items-center gap-1"><IconaOk /> Salvato</span> : 'Salva'}</button>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold text-gray-700">Lettura a mano</h2>
          <button className="btn-secondary" disabled={inCorso || !st?.config.percorso || !!cambiata} onClick={leggi}>
            {inCorso ? 'Lettura in corso…' : 'Leggi la cartella adesso'}
          </button>
          {cambiata && <span className="text-xs text-amber-700">Salva prima le modifiche.</span>}
          {!st?.config.percorso && !cambiata && <span className="text-xs text-gray-400">Scegli prima la cartella.</span>}
        </div>

        <h3 className="mt-5 mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Ultime letture</h3>
        {!st || st.letture.length === 0 ? <p className="text-sm text-gray-400">Nessuna lettura ancora.</p> : (
          <table className="w-full text-sm">
            <tbody>
              {st.letture.map(l => (
                <>
                  <tr key={l.id} className="border-t border-gray-100 cursor-pointer hover:bg-gray-50" onClick={() => setAperta(aperta === l.id ? null : l.id)}>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{quando(l.avviato_at)}</td>
                    <td className="py-1.5 pr-3 text-gray-500">{l.tipo === 'auto' ? 'automatica' : `manuale${l.utente ? ` (${l.utente})` : ''}`}</td>
                    <td className={`py-1.5 pr-3 ${l.errore || l.errori > 0 ? 'text-red-700' : ''}`}>{l.finito_at ? riassunto(l) : 'in corso…'}</td>
                    <td className="py-1.5 text-right text-xs text-gray-400">{l.invariati > 0 && `${l.invariati} invariate`}</td>
                  </tr>
                  {aperta === l.id && l.dettaglio.length > 0 && (
                    <tr key={`${l.id}-d`}><td colSpan={4} className="bg-gray-50 px-3 py-2">
                      {l.dettaglio.map((d, i) => (
                        <div key={i} className="text-xs">
                          <span className="font-mono">{d.nome}</span> — {d.esito}{d.commessa ? ` (commessa ${d.commessa})` : ''}{d.motivo ? `: ${d.motivo}` : ''}
                        </div>
                      ))}
                    </td></tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

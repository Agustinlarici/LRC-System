'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import Link from 'next/link';
import { Cella, Errore, FerrariNav, VistaToggle } from '@/components/ferrari/Comuni';

interface Componente { nome: string; termini: string[] }
interface Elenco {
  modello: string;
  modelli: { modello: string; schede: number }[];
  componenti: Componente[];
}
interface Voce {
  termine: string; codice: string; voce: string; testo: string; completo: string | null; rivedere: boolean;
  avviso: string | null;
  sub: { codice: string; testo: string; avviso: string | null }[];
}
interface Risultati {
  componenti: string[];
  risultati: { commessa: string; versione: string | null; componenti: { nome: string; vuoto: boolean; voci: Voce[] }[] }[];
}

export default function PerComponentePage() {
  const { canManage } = useAuth();
  const puoModificare = canManage('ferrari_schede');
  const [modello, setModello] = useState('');
  const [q, setQ] = useState('');
  const [comp, setComp] = useState('');
  const [el, setEl] = useState<Elenco | null>(null);
  const [ris, setRis] = useState<Risultati | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  const caricaElenco = useCallback(async (mod: string) => {
    try {
      const r = await api.get<Elenco>(`/api/ferrari/componenti?modello=${encodeURIComponent(mod)}`);
      setEl(r);
      setModello(r.modello);
      setErrore(null);
    } catch (e) {
      setErrore((e as Error).message);
    }
  }, []);

  const cerca = useCallback(async (mod: string, testo: string, componente: string) => {
    if (!mod) { setRis(null); return; }
    try {
      setRis(await api.get<Risultati>(
        `/api/ferrari/componenti/cerca?modello=${encodeURIComponent(mod)}&q=${encodeURIComponent(testo)}&componente=${encodeURIComponent(componente)}`));
    } catch (e) {
      setErrore((e as Error).message);
    }
  }, []);

  useEffect(() => { caricaElenco(''); }, [caricaElenco]);
  useEffect(() => {
    const t = setTimeout(() => cerca(modello, q.trim(), comp), 200);
    return () => clearTimeout(t);
  }, [modello, q, comp, cerca]);

  return (
    <div>
      <FerrariNav />
      <Errore messaggio={errore} />

      <div className="d-print-none bg-white rounded-xl border border-gray-200 p-5 mb-6 space-y-4">
        <div className="flex items-start justify-between flex-wrap gap-3 pb-4 border-b border-gray-100">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Programma Produzione</p>
            <h1 className="text-2xl font-bold text-gray-900 mt-1">Programma produzione (schede) — per componente</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <VistaToggle />
            <button className="inline-flex items-center gap-1 text-sm font-medium px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700" onClick={() => window.print()}>🖨️ Stampa</button>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-400">Modello</label>
            <select className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm bg-white" value={modello} onChange={e => { setComp(''); caricaElenco(e.target.value); }}>
              {el?.modelli.map(x => <option key={x.modello} value={x.modello}>{x.modello} ({x.schede})</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-400">Commessa</label>
            <input className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm" placeholder="Es. 100001" value={q} onChange={e => setQ(e.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-400">Componente</label>
            <select className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm bg-white" value={comp} onChange={e => setComp(e.target.value)}>
              <option value="">Tutti i componenti</option>
              {el?.componenti.map(c => <option key={c.nome} value={c.nome}>{c.nome}</option>)}
            </select>
          </div>
        </div>
      </div>

      {!el || !ris ? null : el.modelli.length === 0 ? (
        <p className="text-center text-gray-400 py-10 text-sm">Carica un Excel per iniziare</p>
      ) : el.componenti.length === 0 ? (
        <p className="text-center text-gray-400 py-10 text-sm">Nessun componente per {modello}.{puoModificare && <> Definiscili in <Link href="/ferrari/impostazioni#componenti" className="text-blue-700 hover:underline">Impostazioni → Componenti</Link>.</>}</p>
      ) : ris.risultati.length === 0 ? (
        <p className="text-center text-gray-400 py-10 text-sm">Nessuna commessa trovata</p>
      ) : (
        ris.risultati.map(x => {
          const con = x.componenti.filter(c => !c.vuoto);
          const senza = x.componenti.filter(c => c.vuoto);
          return (
            <div key={x.commessa} className="mb-4 rounded-2xl border border-white/70 bg-white/60 backdrop-blur px-4 py-3 shadow-sm">
              <h2 className="text-base font-semibold">Commessa {x.commessa} <span className="text-xs font-normal text-gray-500">{x.versione}</span></h2>
              {con.map(c => (
                <div key={c.nome} className="border-t border-gray-200/70 py-2 first:border-t-0">
                  <span className="font-semibold">{c.nome}</span>
                  <span className="ml-1.5 rounded-full bg-red-50 px-2 text-xs text-red-700">{c.voci.length}</span>
                  {c.voci.map(v => (
                    <div key={v.codice} className="flex gap-3 py-0.5 text-sm items-baseline">
                      <span className="w-14 shrink-0 font-bold">{v.codice}</span>
                      <span className="w-60 shrink-0 text-xs text-gray-500">{v.voce}</span>
                      <span className="flex-1">
                        {v.rivedere && <span className="text-xs font-semibold text-amber-700" title="La IA non era sicura: va controllato sulla PC IA">⚠ da rivedere </span>}
                        {v.avviso && <div className="text-xs font-semibold text-amber-700">⚠ {v.avviso}</div>}
                        <Cella testo={v.testo} intero={v.completo ?? undefined} />
                        {v.sub.map(x => (
                          <div key={x.codice} className="mt-1 rounded-lg border-l-[3px] border-gray-300 bg-white/60 px-2 py-0.5 text-xs text-gray-600">
                            {x.avviso && <div className="font-semibold text-amber-700">⚠ {x.avviso}</div>}
                            <b>{x.codice}</b> {x.testo}
                          </div>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
              {senza.length > 0 && <p className="pt-1 text-sm text-gray-500">Niente in questa commessa: {senza.map(c => c.nome).join(', ')}</p>}
            </div>
          );
        })
      )}
    </div>
  );
}

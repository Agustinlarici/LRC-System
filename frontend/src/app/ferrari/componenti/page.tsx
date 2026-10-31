'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import Link from 'next/link';
import { Cella, Errore, SottoSigla, VistaToggle } from '@/components/ferrari/Comuni';
import { IconaAvviso } from '@/components/ferrari/Icone';

interface Componente { nome: string; termini: string[] }
interface Elenco {
  modello: string;
  modelli: { modello: string; schede: number }[];
  componenti: Componente[];
}
interface Voce {
  termine: string; codice: string; voce: string; testo: string; completo: string | null; rivedere: boolean;
  avviso: string | null;
  sub: { codice: string; testo: string; avviso: string | null; scritto?: string | null }[];
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
      <div className="mb-6 flex items-start justify-between flex-wrap gap-3 d-print-none">
        <h1 className="text-3xl font-bold text-gray-900">Programma produzione (schede)</h1>
        <div className="flex gap-2 flex-wrap">
          <button className="flex items-center gap-1.5 text-sm border border-gray-200 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors" onClick={() => window.print()}>Stampa</button>
          {puoModificare && <Link href="/ferrari/impostazioni#componenti" className="flex items-center gap-1.5 text-sm border border-gray-200 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors">Impostazioni</Link>}
        </div>
      </div>
      <Errore messaggio={errore} />

      <VistaToggle />

      <div className="d-print-none mb-4 flex flex-wrap items-center gap-2">
        <select className="input !w-auto" value={modello} onChange={e => { setComp(''); caricaElenco(e.target.value); }}>
          {el?.modelli.map(x => <option key={x.modello} value={x.modello}>{x.modello} ({x.schede})</option>)}
        </select>
        <input className="input !w-48" placeholder="Commessa…" value={q} onChange={e => setQ(e.target.value)} autoFocus />
        <select className="input !w-auto" value={comp} onChange={e => setComp(e.target.value)}>
          <option value="">Tutti i componenti</option>
          {el?.componenti.map(c => <option key={c.nome} value={c.nome}>{c.nome}</option>)}
        </select>
      </div>

      {!el || !ris ? null : el.modelli.length === 0 ? (
        <p className="text-center text-gray-400 py-10 text-sm">Carica un Excel per iniziare</p>
      ) : el.componenti.length === 0 ? (
        <p className="text-center text-gray-400 py-10 text-sm">Nessun componente per {modello}.{puoModificare && <> Definiscili in <Link href="/ferrari/impostazioni#componenti" className="text-blue-700 hover:underline">Impostazioni, scheda Componenti</Link>.</>}</p>
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
                        {v.rivedere && <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700" title="Da controllare"><IconaAvviso /> da rivedere </span>}
                        {v.avviso && <div className="flex items-center gap-1 text-xs font-semibold text-amber-700"><IconaAvviso /> {v.avviso}</div>}
                        <Cella testo={v.testo} intero={v.completo ?? undefined} />
                        {v.sub.map(x => <SottoSigla key={x.codice} x={x} modello={modello} onFatto={() => cerca(modello, q.trim(), comp)} onErrore={setErrore} />)}
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

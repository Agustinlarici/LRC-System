'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { usePromptDialog } from '@/components/ui/PromptDialog';
import { Cella, Errore, FerrariNav } from '@/components/ferrari/Comuni';

interface Componente { nome: string; termini: string[] }
interface Elenco {
  modello: string;
  modelli: { modello: string; schede: number }[];
  componenti: Componente[];
  proposte: { modello: string; nome: string; termini: string[]; conflitto: boolean; da: string | null }[];
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
interface Suggerimento { termine: string; nome: string; tipo: 'sigla' | 'parola' }

export default function ComponentiPage() {
  const { canManage } = useAuth();
  const puoModificare = canManage('ferrari_schede');
  const { ask, dialog } = usePromptDialog();
  const [modello, setModello] = useState('');
  const [q, setQ] = useState('');
  const [comp, setComp] = useState('');
  const [el, setEl] = useState<Elenco | null>(null);
  const [ris, setRis] = useState<Risultati | null>(null);
  const [gestione, setGestione] = useState(false);
  const [nuovoNome, setNuovoNome] = useState('');
  const [daModello, setDaModello] = useState('');
  const [errore, setErrore] = useState<string | null>(null);
  const [agg, setAgg] = useState<{ nome: string; testo: string; sug: Suggerimento[] } | null>(null);
  const deb = useRef<ReturnType<typeof setTimeout> | null>(null);

  const caricaElenco = useCallback(async (mod: string) => {
    try {
      const r = await api.get<Elenco>(`/api/ferrari/componenti?modello=${encodeURIComponent(mod)}`);
      setEl(r);
      setModello(r.modello);
      setErrore(null);
      return r;
    } catch (e) {
      setErrore((e as Error).message);
      return null;
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
  }, [modello, q, comp, el, cerca]);

  async function salva(nome: string, termini: string[], vecchio?: string) {
    try {
      await api.post('/api/ferrari/componenti', { modello, nome, termini, vecchio });
      await caricaElenco(modello);
    } catch (e) {
      setErrore((e as Error).message);
    }
  }

  async function rinomina(c: Componente) {
    const r = await ask({ title: `Rinomina «${c.nome}»`, label: 'Nuovo nome' });
    if (typeof r === 'string' && r !== c.nome) await salva(r, c.termini, c.nome);
  }

  async function elimina(c: Componente) {
    if (!confirm(`Eliminare «${c.nome}»?`)) return;
    try {
      await api.delete(`/api/ferrari/componenti?modello=${encodeURIComponent(modello)}&nome=${encodeURIComponent(c.nome)}`);
      await caricaElenco(modello);
    } catch (e) {
      setErrore((e as Error).message);
    }
  }

  async function copia(da: string) {
    try {
      const r = await api.post<{ aggiunti: number }>('/api/ferrari/componenti/copia', { da, a: modello });
      await caricaElenco(modello);
      setErrore(null);
      alert(`${r.aggiunti} componenti aggiunti`);
    } catch (e) {
      setErrore((e as Error).message);
    }
  }

  async function proposta(azione: string, p?: { modello: string; nome: string }) {
    try {
      await api.post('/api/ferrari/componenti/proposte', { azione, modello: p?.modello, nome: p?.nome });
      await caricaElenco(modello);
    } catch (e) {
      setErrore((e as Error).message);
    }
  }

  function scrivi(nome: string, testo: string) {
    setAgg({ nome, testo, sug: [] });
    if (deb.current) clearTimeout(deb.current);
    deb.current = setTimeout(async () => {
      if (testo.trim().length < 2) { setAgg(a => a && { ...a, sug: [] }); return; }
      try {
        const r = await api.get<{ suggerimenti: Suggerimento[] }>(
          `/api/ferrari/componenti/suggerisci?modello=${encodeURIComponent(modello)}&q=${encodeURIComponent(testo.trim())}`);
        setAgg(a => a && a.nome === nome ? { ...a, sug: r.suggerimenti } : a);
      } catch { /* il suggerimento e' solo un aiuto */ }
    }, 150);
  }

  async function aggiungi(c: Componente, termine: string) {
    if (!termine.trim()) return;
    setAgg(null);
    await salva(c.nome, [...c.termini, termine.trim()]);
  }

  const altri = el?.modelli.filter(m => m.modello !== modello) ?? [];

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-3xl font-bold text-gray-900">Componenti</h1>
      </div>
      <FerrariNav />
      <Errore messaggio={errore} />

      {puoModificare && el && el.proposte.length > 0 && (
        <div className="mb-3 rounded-xl border border-sky-300 bg-sky-50 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <b>Dalla PC IA: {el.proposte.length} componenti</b>
            <button className="btn-primary !py-0.5 text-xs" onClick={() => proposta('accetta-tutte')}>Accetta tutti</button>
            <button className="btn-secondary !py-0.5 text-xs" onClick={() => proposta('rifiuta-tutte')}>Rifiuta tutti</button>
          </div>
          {el.proposte.map(p => (
            <div key={`${p.modello}/${p.nome}`} className="mt-1.5 flex flex-wrap items-center gap-2">
              <b>{p.modello}</b> {p.nome}: <span className="text-gray-600">{p.termini.join(', ') || '—'}</span>
              {p.conflitto && <span className="text-xs bg-amber-100 text-amber-800 rounded px-1.5">tu: diverso</span>}
              <button className="btn-primary !py-0.5 text-xs" onClick={() => proposta('accetta', p)}>Accetta</button>
              <button className="btn-secondary !py-0.5 text-xs" onClick={() => proposta('rifiuta', p)}>Rifiuta</button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <select className="input !w-auto" value={modello} onChange={e => { setComp(''); caricaElenco(e.target.value); }}>
          {el?.modelli.map(x => <option key={x.modello} value={x.modello}>{x.modello} ({x.schede})</option>)}
        </select>
        <input className="input !w-64" placeholder="Commessa…" value={q} onChange={e => setQ(e.target.value)} autoFocus />
        <select className="input !w-auto" value={comp} onChange={e => setComp(e.target.value)}>
          <option value="">Tutti i componenti</option>
          {el?.componenti.map(c => <option key={c.nome} value={c.nome}>{c.nome}</option>)}
        </select>
        {puoModificare && (
          <button className="btn-secondary ml-auto" onClick={() => setGestione(g => !g)}>{gestione ? 'Chiudi' : 'Definisci componenti'}</button>
        )}
      </div>

      {gestione && puoModificare && el && (
        <div className="relative z-20 mb-4 rounded-2xl border-2 border-red-500 bg-white/80 backdrop-blur px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <b>Componenti di {modello}</b>
            <input className="input !w-72 !py-1" placeholder="Nuovo componente (es. Paraurti posteriore)" value={nuovoNome}
              onChange={e => setNuovoNome(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && nuovoNome.trim()) { salva(nuovoNome.trim(), []); setNuovoNome(''); } }} />
            <button className="btn-primary !py-1" disabled={!nuovoNome.trim()} onClick={() => { salva(nuovoNome.trim(), []); setNuovoNome(''); }}>Aggiungi</button>
            {altri.length > 0 && (
              <span className="ml-auto flex items-center gap-2 text-gray-500">
                Copia da
                <select className="input !w-auto !py-1" value={daModello || altri[0]!.modello} onChange={e => setDaModello(e.target.value)}>
                  {altri.map(m => <option key={m.modello}>{m.modello}</option>)}
                </select>
                <button className="btn-secondary !py-1" onClick={() => copia(daModello || altri[0]!.modello)}>Copia</button>
              </span>
            )}
          </div>
          {el.componenti.length === 0 && <p className="text-gray-400">Ancora nessun componente: scrivi un nome e premi «Aggiungi».</p>}
          {el.componenti.map(c => (
            <div key={c.nome} className="border-t border-gray-200 py-2">
              <div className="flex items-center gap-2">
                <b>{c.nome}</b>
                <button className="btn-secondary !py-0.5 text-xs" onClick={() => rinomina(c)}>Rinomina</button>
                <button className="btn-secondary !py-0.5 text-xs" onClick={() => elimina(c)}>Elimina</button>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {c.termini.map(t => (
                  <span key={t} className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-0.5">
                    {t}
                    <button className="text-gray-400 hover:text-red-600" title="Togli" onClick={() => salva(c.nome, c.termini.filter(x => x !== t))}>✕</button>
                  </span>
                ))}
                <span className="relative">
                  <input className="input !w-56 !py-1" placeholder="+ sigla o parola" value={agg?.nome === c.nome ? agg.testo : ''}
                    onChange={e => scrivi(c.nome, e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') aggiungi(c, e.currentTarget.value); if (e.key === 'Escape') setAgg(null); }} />
                  {agg?.nome === c.nome && agg.sug.length > 0 && (
                    <div className="absolute z-10 left-0 top-full mt-1 min-w-[22rem] rounded-xl border border-gray-200 bg-white p-1 shadow-lg">
                      {agg.sug.map(s => (
                        <button key={`${s.tipo}/${s.termine}`} className="block w-full text-left rounded-lg px-2.5 py-1.5 hover:bg-red-50"
                          onClick={() => aggiungi(c, s.termine)}>
                          {s.tipo === 'sigla' ? <><b>{s.termine}</b> — {s.nome}</> : <>Parola «<b>{s.termine}</b>» (cerca nel testo)</>}
                        </button>
                      ))}
                    </div>
                  )}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {!el || !ris ? null : el.modelli.length === 0 ? (
        <p className="text-center text-gray-400 py-10 text-sm">Carica un Excel per iniziare</p>
      ) : el.componenti.length === 0 ? (
        <p className="text-center text-gray-400 py-10 text-sm">Nessun componente per {modello}.{puoModificare ? ' Premi «Definisci componenti».' : ''}</p>
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
      {dialog}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { usePromptDialog } from '@/components/ui/PromptDialog';
import { Errore } from '@/components/ferrari/Comuni';
import { IconaChiudi } from '@/components/ferrari/Icone';

interface Componente { nome: string; termini: string[] }
interface Elenco {
  modello: string;
  modelli: { modello: string; schede: number }[];
  componenti: Componente[];
  proposte: { modello: string; nome: string; termini: string[]; conflitto: boolean; da: string | null }[];
}
interface Suggerimento { termine: string; nome: string; tipo: 'sigla' | 'parola' }

/** Impostazioni, scheda Componenti: definire i componenti di un modello (nome + sigle/parole), copiarli in altri modelli. */
export function ComponentiGestione({ onCambia }: { onCambia?: () => void }) {
  const { ask, dialog } = usePromptDialog();
  const [modello, setModello] = useState('');
  const [el, setEl] = useState<Elenco | null>(null);
  const [nuovoNome, setNuovoNome] = useState('');
  const [daModello, setDaModello] = useState('');
  const [errore, setErrore] = useState<string | null>(null);
  const [agg, setAgg] = useState<{ nome: string; testo: string; sug: Suggerimento[] } | null>(null);
  const [anche, setAnche] = useState<{ nome: string; scelti: string[] } | null>(null);
  const deb = useRef<ReturnType<typeof setTimeout> | null>(null);

  const caricaElenco = useCallback(async (mod: string) => {
    try {
      const r = await api.get<Elenco>(`/api/ferrari/componenti?modello=${encodeURIComponent(mod)}`);
      setEl(r);
      setModello(r.modello);
      setErrore(null);
      onCambia?.();
    } catch (e) {
      setErrore((e as Error).message);
    }
  }, [onCambia]);

  useEffect(() => { caricaElenco(''); }, [caricaElenco]);

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
    if (!confirm(`Eliminare «${c.nome}» da ${modello}?`)) return;
    try {
      await api.delete(`/api/ferrari/componenti?modello=${encodeURIComponent(modello)}&nome=${encodeURIComponent(c.nome)}`);
      await caricaElenco(modello);
    } catch (e) {
      setErrore((e as Error).message);
    }
  }

  async function copia(da: string) {
    if (!confirm(`Copiare in ${modello} i componenti di ${da}?`)) return;
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

  async function applica(c: Componente) {
    if (!anche || anche.scelti.length === 0) return;
    try {
      const r = await api.post<{ scritti: number }>('/api/ferrari/componenti/applica', { da: modello, nome: c.nome, a: anche.scelti });
      setAnche(null);
      setErrore(null);
      alert(`«${c.nome}» copiato in ${r.scritti} modelli`);
    } catch (e) {
      setErrore((e as Error).message);
    }
  }

  const altri = el?.modelli.filter(m => m.modello !== modello) ?? [];

  return (
    <div>
      <p className="mb-3 text-sm text-gray-500">Un componente (es. Paraurti posteriore) è un nome con le sigle o parole che lo compongono, per modello. In «Per componente» cerchi commessa + componente.</p>
      <Errore messaggio={errore} />
      {el && el.proposte.length > 0 && (
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

      {el && (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <select className="input !w-auto !py-1" value={modello} onChange={e => { setAnche(null); caricaElenco(e.target.value); }}>
              {el.modelli.map(x => <option key={x.modello} value={x.modello}>{x.modello} ({x.schede})</option>)}
            </select>
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
          {el.componenti.length === 0 && <p className="text-gray-400">Nessun componente per {modello}: scrivi un nome (es. Paraurti posteriore) e premi «Aggiungi».</p>}
          {el.componenti.map(c => (
            <div key={c.nome} className="border-t border-gray-200 py-2">
              <div className="flex items-center gap-2">
                <b>{c.nome}</b>
                <button className="btn-secondary !py-0.5 text-xs" onClick={() => rinomina(c)}>Rinomina</button>
                <button className="btn-secondary !py-0.5 text-xs" onClick={() => elimina(c)}>Elimina</button>
                {altri.length > 0 && <button className="btn-secondary !py-0.5 text-xs" onClick={() => setAnche(anche?.nome === c.nome ? null : { nome: c.nome, scelti: [] })}>Anche in altri modelli…</button>}
              </div>
              {anche?.nome === c.nome && (
                <div className="mt-1 flex flex-wrap items-center gap-3 rounded-lg bg-gray-50 px-3 py-1.5">
                  {altri.map(m => (
                    <label key={m.modello} className="flex items-center gap-1">
                      <input type="checkbox" checked={anche.scelti.includes(m.modello)}
                        onChange={e => setAnche({ ...anche, scelti: e.target.checked ? [...anche.scelti, m.modello] : anche.scelti.filter(x => x !== m.modello) })} /> {m.modello}
                    </label>
                  ))}
                  <button className="btn-primary !py-0.5 text-xs" disabled={anche.scelti.length === 0} onClick={() => applica(c)}>Copia</button>
                </div>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {c.termini.map(t => (
                  <span key={t} className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-0.5">
                    {t}
                    <button className="text-gray-400 hover:text-red-600" title="Togli" onClick={() => salva(c.nome, c.termini.filter(x => x !== t))}><IconaChiudi /></button>
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

      {dialog}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { inviaFile } from '@/lib/ferrari';
import { Errore, FerrariNav } from '@/components/ferrari/Comuni';

interface Matrice {
  modelli: { modello: string; schede: number }[];
  modello: string;
  termini: string[];
  nuove: { codice: string; nome: string; esempio: string }[];
  sigle: { codice: string; nome: string; va: boolean; ambito: 'modello' | 'tutti' }[];
  righe: { id: number; commessa: string; modello: string | null; paese: string | null; stato: string;
    celle: Record<string, string>; testi: Record<string, string> }[];
}

function Cella({ testo, intero }: { testo?: string; intero?: string }) {
  if (!testo) return <span className="text-gray-300">—</span>;
  if (testo === 'Sì') return <span className="font-bold text-green-600" title={intero}>Sì</span>;
  if (testo.startsWith('Sì — ')) {
    return <span title={intero}><span className="font-bold text-green-600">Sì</span> {testo.slice(5)}</span>;
  }
  return <span title={intero}>{testo}</span>;
}

export default function CommessePage() {
  const { canManage } = useAuth();
  const puoCaricare = canManage('ferrari_schede');
  const [q, setQ] = useState('');
  const [modello, setModello] = useState('');
  const [nuovo, setNuovo] = useState('');
  const [dopo, setDopo] = useState<Set<string>>(new Set());   // sigle rimandate in questa sessione
  const [panello, setPanello] = useState(false);
  const [m, setM] = useState<Matrice | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [msg, setMsg] = useState<string[]>([]);
  const [occupato, setOccupato] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const carica = useCallback(async (mod: string, testo: string) => {
    try {
      const r = await api.get<Matrice>(`/api/ferrari/matrice?modello=${encodeURIComponent(mod)}&q=${encodeURIComponent(testo)}`);
      setM(r);
      setModello(r.modello);
      setErrore(null);
    } catch (e) {
      setErrore((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => carica(modello, q.trim()), 200);
    return () => clearTimeout(t);
    // il modello si aggiorna da solo con la risposta: si ricarica solo quando cambia la ricerca o lo scelgo io
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, carica]);

  async function decidi(codice: string, va: boolean, tutti: boolean) {
    if (!codice.trim() || !modello) return;
    try {
      await api.post('/api/ferrari/sigle', { modello, codice, va, tutti });
      setNuovo('');
      await carica(modello, q.trim());
    } catch (e) {
      setErrore((e as Error).message);
    }
  }

  async function chiediDiNuovo(codice: string, tutti: boolean) {
    try {
      await api.delete(`/api/ferrari/sigle?modello=${encodeURIComponent(modello)}&codice=${encodeURIComponent(codice)}${tutti ? '&tutti=1' : ''}`);
      await carica(modello, q.trim());
    } catch (e) {
      setErrore((e as Error).message);
    }
  }

  async function tutteNo() {
    try {
      await api.post('/api/ferrari/sigle/tutte-no', { modello });
      await carica(modello, q.trim());
    } catch (e) {
      setErrore((e as Error).message);
    }
  }

  const prossima = m?.nuove.find(n => !dopo.has(`${m.modello}/${n.codice}`));

  async function invia(files: File[]) {
    if (files.length === 0) return;
    setOccupato(true);
    try {
      const r = await inviaFile<{ risultati: { filename: string; stato?: string; duplicato?: boolean; motivo?: string; errore?: string }[] }>(
        '/api/ferrari/files', 'files', files);
      setMsg(r.risultati.map(x => x.errore ? `${x.filename}: ${x.errore}` : x.stato === 'QUARANTENA' ? `${x.filename}: non è una scheda (${x.motivo})`
        : x.duplicato ? `${x.filename}: già caricata` : `${x.filename}: caricata`));
      await carica(modello, q.trim());
    } catch (e) {
      setErrore((e as Error).message);
    } finally {
      setOccupato(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function scarica() {
    if (!m) return;
    const cella = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const righe = [['Commessa', 'Modello', ...m.termini].map(cella).join(';')];
    for (const r of m.righe) righe.push([r.commessa, r.modello ?? '', ...m.termini.map(x => r.celle[x] ?? '')].map(cella).join(';'));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + righe.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = `schede_ferrari_${m.modello}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-3xl font-bold text-gray-900">Schede Ferrari</h1>
        <p className="mt-1 text-gray-500">Per ogni modello decidi quali sigle vanno in tabella (es. BIC2): vedi, per ogni commessa, «Sì» o il valore trovato (es. NERO DS 1250). Quando compare una sigla nuova, l&apos;app chiede.</p>
      </div>
      <FerrariNav />
      <Errore messaggio={errore} />

      {puoCaricare && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input ref={inputRef} type="file" multiple accept=".xls,.xlsx" className="hidden" onChange={e => invia(Array.from(e.target.files ?? []))} />
          <button className="btn-secondary" disabled={occupato} onClick={() => inputRef.current?.click()}>{occupato ? 'Caricamento…' : 'Carica Excel'}</button>
          <span className="text-xs text-gray-500">{msg.join(' · ')}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <select className="input !w-auto" value={modello} onChange={e => { setModello(e.target.value); carica(e.target.value, q.trim()); }}>
          {m?.modelli.map(x => <option key={x.modello} value={x.modello}>{x.modello} ({x.schede})</option>)}
        </select>
        <input className="input !w-64" placeholder="Cerca commessa…" value={q} onChange={e => setQ(e.target.value)} autoFocus />
        <span className="text-sm text-gray-500">{m ? `${m.righe.length} commesse` : ''}</span>
        <button className="btn-secondary ml-auto" disabled={!m || m.righe.length === 0} onClick={scarica}>Scarica per Excel</button>
        <Link href="/ferrari/schede" className="text-sm text-blue-700 hover:underline">Revisione e analisi IA →</Link>
      </div>

      {puoCaricare && m && prossima && (
        <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm">
          Nuova sigla per <b>{m.modello}</b> ({m.nuove.length} da decidere): <b className="text-base">{prossima.codice}</b> — {prossima.nome}
          <span className="text-gray-500"> · esempio: {prossima.esempio}</span> · Va in tabella?
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button className="btn-primary !py-1" onClick={() => decidi(prossima.codice, true, false)}>Sì, per {m.modello}</button>
            <button className="btn-primary !py-1" onClick={() => decidi(prossima.codice, true, true)}>Sì, per tutti i modelli</button>
            <button className="btn-secondary !py-1" onClick={() => decidi(prossima.codice, false, false)}>No, per {m.modello}</button>
            <button className="btn-secondary !py-1" onClick={() => decidi(prossima.codice, false, true)}>No, per tutti</button>
            <button className="btn-secondary !py-1" onClick={() => setDopo(new Set(dopo).add(`${m.modello}/${prossima.codice}`))}>Dopo</button>
            {m.nuove.length > 1 && <button className="btn-secondary !py-1" onClick={tutteNo}>Tutte le altre: no ({m.modello})</button>}
          </div>
        </div>
      )}

      {m && m.modello && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {m.termini.map(t => (
            <span key={t} className="inline-flex items-center gap-1.5 bg-white border border-gray-300 rounded-full pl-3 pr-2 py-0.5 text-sm">
              <b>{t}</b>
              {puoCaricare && <button className="text-gray-400 hover:text-red-600" title="Togli dalla tabella" onClick={() => decidi(t, false, false)}>✕</button>}
            </span>
          ))}
          {puoCaricare && (
            <input className="input !w-56 !py-1" placeholder="+ sigla o parola (es. BIC2)" value={nuovo}
              onChange={e => setNuovo(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') decidi(nuovo, true, false); }} />
          )}
          <button className="btn-secondary !py-1 text-xs" onClick={() => setPanello(!panello)}>Tutte le sigle</button>
        </div>
      )}

      {panello && m && (
        <div className="mb-3 bg-white rounded-xl border border-gray-200 p-3 max-h-[40vh] overflow-auto text-sm">
          {m.sigle.length === 0 ? <p className="text-gray-400">Nessuna decisione ancora</p> : (
            <table className="w-full">
              <tbody>
                {m.sigle.map(s => (
                  <tr key={s.codice} className="border-b border-gray-100">
                    <td className="py-1 pr-3 font-semibold">{s.codice}</td>
                    <td className="py-1 pr-3 text-gray-500">{s.nome}</td>
                    <td className={`py-1 pr-3 ${s.va ? 'text-green-600 font-semibold' : 'text-gray-400'}`}>
                      {s.va ? 'va' : 'non va'} <span className="text-gray-400 font-normal">({s.ambito === 'tutti' ? 'tutti i modelli' : m.modello})</span>
                    </td>
                    <td className="py-1 text-right whitespace-nowrap">
                      {puoCaricare && <>
                        <button className="btn-secondary !py-0.5 text-xs mr-1" onClick={() => decidi(s.codice, !s.va, false)}>{s.va ? 'Non va' : 'Va'}</button>
                        <button className="btn-secondary !py-0.5 text-xs" onClick={() => chiediDiNuovo(s.codice, s.ambito === 'tutti')}>Chiedi di nuovo</button>
                      </>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-auto max-h-[70vh]">
        {!m || m.modelli.length === 0 ? (
          <p className="text-center text-gray-400 py-10 text-sm">Ancora nessuna scheda: carica gli Excel di Ferrari</p>
        ) : m.termini.length === 0 ? (
          <p className="text-gray-500 py-8 px-6 text-sm">
            Nessuna sigla scelta per il modello <b>{m.modello}</b>: rispondi alle domande qui sopra (sono le sigle della prima colonna dell&apos;Excel).
          </p>
        ) : m.righe.length === 0 ? (
          <p className="text-center text-gray-400 py-10 text-sm">Nessuna commessa trovata</p>
        ) : (
          <table className="text-sm border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky top-0 left-0 z-30 bg-gray-50 border-b border-r-2 border-gray-200 px-3 py-2 text-left min-w-[130px]">Commessa</th>
                {m.termini.map(t => (
                  <th key={t} className="sticky top-0 z-20 bg-gray-50 border-b border-l border-gray-200 px-3 py-2 text-left font-semibold min-w-[120px]">{t}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {m.righe.map(r => (
                <tr key={r.id} className="hover:bg-gray-50 align-top">
                  <td className="sticky left-0 z-10 bg-white border-b border-r-2 border-gray-200 px-3 py-2 font-semibold">
                    <Link href={`/ferrari/${r.id}`} className="text-blue-700 hover:underline">{r.commessa}</Link>
                  </td>
                  {m.termini.map(t => (
                    <td key={t} className="border-b border-l border-gray-100 px-3 py-2 max-w-[320px]"><Cella testo={r.celle[t]} intero={r.testi[t]} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

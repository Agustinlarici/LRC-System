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
  suggerimenti: { codice: string; nome: string }[];
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

  async function aggiungi(termine: string) {
    if (!termine.trim() || !modello) return;
    try {
      await api.post('/api/ferrari/termini', { modello, termine });
      setNuovo('');
      await carica(modello, q.trim());
    } catch (e) {
      setErrore((e as Error).message);
    }
  }

  async function togli(termine: string) {
    try {
      await api.delete(`/api/ferrari/termini?modello=${encodeURIComponent(modello)}&termine=${encodeURIComponent(termine)}`);
      await carica(modello, q.trim());
    } catch (e) {
      setErrore((e as Error).message);
    }
  }

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
        <p className="mt-1 text-gray-500">Per ogni modello scegli le sigle o parole da cercare (es. BIC2): in tabella vedi, per ogni commessa, «Sì» o il valore trovato (es. NERO DS 1250).</p>
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

      {m && m.modello && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {m.termini.map(t => (
            <span key={t} className="inline-flex items-center gap-1.5 bg-white border border-gray-300 rounded-full pl-3 pr-2 py-0.5 text-sm">
              <b>{t}</b>
              {puoCaricare && <button className="text-gray-400 hover:text-red-600" title="Togli" onClick={() => togli(t)}>✕</button>}
            </span>
          ))}
          {puoCaricare && (
            <input className="input !w-56 !py-1" placeholder="+ sigla o parola (es. BIC2)" value={nuovo}
              onChange={e => setNuovo(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') aggiungi(nuovo); }} />
          )}
          {puoCaricare && m.suggerimenti.slice(0, 40).map(s => (
            <button key={s.codice} title={s.nome} onClick={() => aggiungi(s.codice)}
              className="border border-dashed border-gray-300 rounded-full px-2.5 py-0.5 text-sm text-gray-500 hover:text-gray-900 hover:border-blue-500">+ {s.codice}</button>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-auto max-h-[70vh]">
        {!m || m.modelli.length === 0 ? (
          <p className="text-center text-gray-400 py-10 text-sm">Ancora nessuna scheda: carica gli Excel di Ferrari</p>
        ) : m.termini.length === 0 ? (
          <p className="text-gray-500 py-8 px-6 text-sm">
            Scegli le sigle o parole da cercare per il modello <b>{m.modello}</b>: scrivile qui sopra oppure clicca quelle suggerite
            (sono le sigle della prima colonna dell&apos;Excel).
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

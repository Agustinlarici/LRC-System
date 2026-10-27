'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { inviaFile } from '@/lib/ferrari';
import { Errore, FerrariNav } from '@/components/ferrari/Comuni';

interface Matrice {
  colonne: { codice: string; nome: string }[];
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
  const [m, setM] = useState<Matrice | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [msg, setMsg] = useState<string[]>([]);
  const [occupato, setOccupato] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const carica = useCallback(async (testo: string) => {
    try {
      setM(await api.get<Matrice>(`/api/ferrari/matrice?q=${encodeURIComponent(testo)}`));
      setErrore(null);
    } catch (e) {
      setErrore((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => carica(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q, carica]);

  async function invia(files: File[]) {
    if (files.length === 0) return;
    setOccupato(true);
    try {
      const r = await inviaFile<{ risultati: { filename: string; stato?: string; duplicato?: boolean; motivo?: string; errore?: string }[] }>(
        '/api/ferrari/files', 'files', files);
      setMsg(r.risultati.map(x => x.errore ? `${x.filename}: ${x.errore}` : x.stato === 'QUARANTENA' ? `${x.filename}: non è una scheda (${x.motivo})`
        : x.duplicato ? `${x.filename}: già caricata` : `${x.filename}: caricata`));
      await carica(q.trim());
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
    const righe = [['Commessa', 'Modello', 'Paese', ...m.colonne.map(c => c.nome || c.codice)].map(cella).join(';')];
    for (const r of m.righe) righe.push([r.commessa, r.modello ?? '', r.paese ?? '', ...m.colonne.map(c => r.celle[c.codice] ?? '')].map(cella).join(';'));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + righe.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = 'schede_ferrari.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-3xl font-bold text-gray-900">Schede Ferrari</h1>
        <p className="mt-1 text-gray-500">Cerca una commessa: vedi «Sì» o il dettaglio (colore, filo…) per ogni caratteristica.</p>
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
        <input className="input !w-72" placeholder="Cerca commessa…" value={q} onChange={e => setQ(e.target.value)} autoFocus />
        <span className="text-sm text-gray-500">{m ? `${m.righe.length} commesse` : ''}</span>
        <button className="btn-secondary ml-auto" disabled={!m || m.righe.length === 0} onClick={scarica}>Scarica per Excel</button>
        <Link href="/ferrari/schede" className="text-sm text-blue-700 hover:underline">Revisione e analisi IA →</Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-auto max-h-[70vh]">
        {m && m.righe.length === 0 ? (
          <p className="text-center text-gray-400 py-10 text-sm">{q ? 'Nessuna commessa trovata' : 'Ancora nessuna scheda: carica gli Excel di Ferrari'}</p>
        ) : m && (
          <table className="text-sm border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky top-0 left-0 z-30 bg-gray-50 border-b border-r-2 border-gray-200 px-3 py-2 text-left min-w-[130px]">Commessa</th>
                <th className="sticky top-0 z-20 bg-gray-50 border-b border-gray-200 px-3 py-2 text-left">Modello</th>
                <th className="sticky top-0 z-20 bg-gray-50 border-b border-gray-200 px-3 py-2 text-left">Paese</th>
                {m.colonne.map(c => (
                  <th key={c.codice} title={c.codice} className="sticky top-0 z-20 bg-gray-50 border-b border-l border-gray-200 px-3 py-2 text-left font-semibold min-w-[130px] max-w-[220px]">{c.nome || c.codice}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {m.righe.map(r => (
                <tr key={r.id} className="hover:bg-gray-50 align-top">
                  <td className="sticky left-0 z-10 bg-white border-b border-r-2 border-gray-200 px-3 py-2 font-semibold">
                    <Link href={`/ferrari/${r.id}`} className="text-blue-700 hover:underline">{r.commessa}</Link>
                  </td>
                  <td className="border-b border-gray-100 px-3 py-2">{r.modello}</td>
                  <td className="border-b border-gray-100 px-3 py-2">{r.paese}</td>
                  {m.colonne.map(c => (
                    <td key={c.codice} className="border-b border-l border-gray-100 px-3 py-2 max-w-[320px]"><Cella testo={r.celle[c.codice]} intero={r.testi[c.codice]} /></td>
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

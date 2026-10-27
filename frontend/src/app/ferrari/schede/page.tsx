'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  STATI, fmtData, inviaFile,
  type Esito, type FileRiga, type Riepilogo, type StatoFile,
} from '@/lib/ferrari';
import { Errore, EsitoDot, FerrariNav, StatoBadge } from '@/components/ferrari/Comuni';

const PAGINA = 50;

interface EsitoCarica { filename: string; id?: number; stato?: string; duplicato?: boolean; sostituisce?: number[]; stessa_commessa?: number[]; motivo?: string; errore?: string }

export default function SchedePage() {
  const { canManage } = useAuth();
  const puoOperare = canManage('ferrari_schede');

  const [righe, setRighe] = useState<FileRiga[]>([]);
  const [totale, setTotale] = useState(0);
  const [riepilogo, setRiepilogo] = useState<Riepilogo | null>(null);
  const [stato, setStato] = useState<StatoFile | ''>('');
  const [esito, setEsito] = useState<Esito | ''>('');
  const [q, setQ] = useState('');
  const [qApplicata, setQApplicata] = useState('');
  const [pagina, setPagina] = useState(0);
  const [errore, setErrore] = useState<string | null>(null);
  const [caricando, setCaricando] = useState(false);
  const [esitiCarica, setEsitiCarica] = useState<EsitoCarica[] | null>(null);
  const [trascina, setTrascina] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const carica = useCallback(async () => {
    const p = new URLSearchParams({ limite: String(PAGINA), offset: String(pagina * PAGINA) });
    if (stato) p.set('stato', stato);
    if (esito) p.set('esito', esito);
    if (qApplicata) p.set('q', qApplicata);
    try {
      const [lista, riep] = await Promise.all([
        api.get<{ totale: number; righe: FileRiga[] }>(`/api/ferrari/files?${p}`),
        api.get<Riepilogo>('/api/ferrari/summary'),
      ]);
      setRighe(lista.righe);
      setTotale(lista.totale);
      setRiepilogo(riep);
      setErrore(null);
    } catch (e) {
      setErrore((e as Error).message);
    }
  }, [stato, esito, qApplicata, pagina]);

  useEffect(() => { carica(); }, [carica]);

  async function invia(files: File[]) {
    if (files.length === 0) return;
    setCaricando(true);
    setEsitiCarica(null);
    try {
      const r = await inviaFile<{ risultati: EsitoCarica[] }>('/api/ferrari/files', 'files', files);
      setEsitiCarica(r.risultati);
      setPagina(0);
      await carica();
    } catch (e) {
      setErrore((e as Error).message);
    } finally {
      setCaricando(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const nPagine = Math.max(1, Math.ceil(totale / PAGINA));
  const conta = (s: StatoFile) => riepilogo?.stati[s] ?? 0;

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-3xl font-bold text-gray-900">Revisione delle schede</h1>
        <p className="mt-1 text-gray-500">
          Excel di allestimento ricevuti da Ferrari: analisi con IA locale e con la VM, confronto e revisione.
        </p>
      </div>
      <FerrariNav />
      <Errore messaggio={errore} />

      {riepilogo && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
          {STATI.map(s => (
            <button key={s.value} onClick={() => { setStato(stato === s.value ? '' : s.value); setPagina(0); }}
              className={`text-left rounded-xl border p-3 transition-colors ${stato === s.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}>
              <div className="text-2xl font-bold text-gray-900">{conta(s.value)}</div>
              <div className="text-xs text-gray-500">{s.label}</div>
            </button>
          ))}
        </div>
      )}

      {riepilogo && (riepilogo.proposte.codici + riepilogo.proposte.componenti > 0 || riepilogo.ia_in_ritardo > 0) && (
        <div className="mb-6 flex flex-wrap gap-3 text-sm">
          {riepilogo.proposte.codici + riepilogo.proposte.componenti > 0 && (
            <Link href="/ferrari/conoscenza" className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 hover:bg-amber-100">
              {riepilogo.proposte.codici + riepilogo.proposte.componenti} regole proposte aspettano l&apos;approvazione del supervisore
            </Link>
          )}
          {riepilogo.ia_in_ritardo > 0 && (
            <Link href="/ferrari/scambio" className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2 hover:bg-red-100">
              {riepilogo.ia_in_ritardo} schede inviate alla IA senza risposta oltre il tempo previsto
            </Link>
          )}
        </div>
      )}

      {puoOperare && (
        <div
          onDragOver={e => { e.preventDefault(); setTrascina(true); }}
          onDragLeave={() => setTrascina(false)}
          onDrop={e => { e.preventDefault(); setTrascina(false); invia(Array.from(e.dataTransfer.files)); }}
          className={`mb-6 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${trascina ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white'}`}
        >
          <p className="text-sm text-gray-600 mb-3">Trascina qui gli Excel di Ferrari (.xls / .xlsx) oppure</p>
          <input ref={inputRef} type="file" multiple accept=".xls,.xlsx" className="hidden"
            onChange={e => invia(Array.from(e.target.files ?? []))} />
          <button className="btn-primary" disabled={caricando} onClick={() => inputRef.current?.click()}>
            {caricando ? 'Caricamento in corso…' : 'Scegli i file'}
          </button>
          <p className="text-xs text-gray-400 mt-2">L&apos;originale viene conservato così com&apos;è e non si modifica mai.</p>
        </div>
      )}

      {esitiCarica && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white divide-y divide-gray-100">
          {esitiCarica.map((r, i) => (
            <div key={i} className="px-4 py-2 text-sm flex flex-wrap items-center gap-2">
              <span className="font-medium text-gray-800">{r.filename}</span>
              {r.errore && <span className="text-red-600">{r.errore}</span>}
              {r.duplicato && <span className="text-amber-700">già ricevuto (stesso contenuto): nessuna nuova scheda</span>}
              {r.stato === 'QUARANTENA' && <span className="text-red-600">in quarantena: {r.motivo}</span>}
              {r.stato === 'IN_ATTESA_IA' && !r.duplicato && <span className="text-green-700">ricevuto, in attesa dell&apos;analisi IA</span>}
              {r.sostituisce && r.sostituisce.length > 0 && <span className="text-sky-700">sostituisce la scheda #{r.sostituisce.join(', #')}</span>}
              {r.stessa_commessa && r.stessa_commessa.length > 0 && (
                <span className="text-amber-700">attenzione: esiste già la scheda #{r.stessa_commessa.join(', #')} con la stessa commessa ma una variante diversa</span>
              )}
              {r.id && <Link href={`/ferrari/${r.id}`} className="ml-auto text-blue-600 hover:underline">apri</Link>}
            </div>
          ))}
        </div>
      )}

      <form className="flex flex-wrap items-end gap-3 mb-4" onSubmit={e => { e.preventDefault(); setQApplicata(q.trim()); setPagina(0); }}>
        <div className="flex-1 min-w-[220px]">
          <label className="label">Cerca</label>
          <input className="input" placeholder="Commessa, matricola, modello, nome file…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <div>
          <label className="label">Stato</label>
          <select className="input" value={stato} onChange={e => { setStato(e.target.value as StatoFile | ''); setPagina(0); }}>
            <option value="">Tutti</option>
            {STATI.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Esito</label>
          <select className="input" value={esito} onChange={e => { setEsito(e.target.value as Esito | ''); setPagina(0); }}>
            <option value="">Tutti</option>
            <option value="VERDE">Verde</option>
            <option value="AMBRA">Ambra</option>
            <option value="ROSSO">Rosso</option>
          </select>
        </div>
        <button className="btn-secondary" type="submit">Cerca</button>
      </form>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
              <th className="py-2.5 px-4 text-left font-medium">Commessa</th>
              <th className="py-2.5 px-4 text-left font-medium">Modello</th>
              <th className="py-2.5 px-4 text-left font-medium">Mercato</th>
              <th className="py-2.5 px-4 text-left font-medium">Stato</th>
              <th className="py-2.5 px-4 text-left font-medium">Esito</th>
              <th className="py-2.5 px-4 text-right font-medium">Da rivedere</th>
              <th className="py-2.5 px-4 text-left font-medium">Ricevuta</th>
            </tr>
          </thead>
          <tbody>
            {righe.length === 0 ? (
              <tr><td colSpan={7} className="text-center text-gray-400 py-8">Nessuna scheda</td></tr>
            ) : righe.map(r => (
              <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2 px-4">
                  <Link href={`/ferrari/${r.id}`} className="font-medium text-blue-700 hover:underline">{r.commessa ?? r.filename}</Link>
                  <div className="text-xs text-gray-400 truncate max-w-[260px]">{r.filename}</div>
                </td>
                <td className="py-2 px-4">
                  <div className="font-medium">{r.modello ?? '—'}</div>
                  <div className="text-xs text-gray-400">{r.versione}</div>
                </td>
                <td className="py-2 px-4">{r.paese ?? '—'}{r.mercato_codice ? <span className="text-gray-400"> ({r.mercato_codice})</span> : null}</td>
                <td className="py-2 px-4">
                  <StatoBadge stato={r.stato} />
                  {r.campione && r.stato === 'IN_REVISIONE' && <div className="text-[11px] text-gray-400 mt-0.5">a campione</div>}
                  {r.stato === 'QUARANTENA' && <div className="text-[11px] text-red-500 mt-0.5 max-w-[220px] truncate" title={r.quarantena_motivo ?? ''}>{r.quarantena_motivo}</div>}
                </td>
                <td className="py-2 px-4"><EsitoDot esito={r.esito} /></td>
                <td className="py-2 px-4 text-right">
                  {r.stato === 'IN_REVISIONE'
                    ? <span className={r.n_items - r.n_decisioni > 0 ? 'font-semibold text-amber-700' : 'text-green-700'}>{Math.max(r.n_items - r.n_decisioni, 0)}</span>
                    : <span className="text-gray-300">—</span>}
                </td>
                <td className="py-2 px-4 text-gray-500 whitespace-nowrap">{fmtData(r.caricato_at)}<div className="text-xs">{r.caricato_da}</div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {nPagine > 1 && (
        <div className="flex items-center justify-between mt-3 text-sm text-gray-500">
          <span>{totale} schede</span>
          <div className="flex items-center gap-2">
            <button className="btn-secondary" disabled={pagina === 0} onClick={() => setPagina(p => p - 1)}>←</button>
            <span>{pagina + 1} / {nPagine}</span>
            <button className="btn-secondary" disabled={pagina + 1 >= nPagine} onClick={() => setPagina(p => p + 1)}>→</button>
          </div>
        </div>
      )}
    </div>
  );
}

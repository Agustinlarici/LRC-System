'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { inviaFile } from '@/lib/ferrari';
import { AnomalieRiga, Cella, Errore, SottoSigla, VistaToggle } from '@/components/ferrari/Comuni';
import { InfoCartella, type StatoCartella } from '@/components/ferrari/InfoCartella';

interface Riga {
  id: number; commessa: string; modello: string | null;
  celle: Record<string, string>; testi: Record<string, string>; rivedere: Record<string, boolean>;
  sub: Record<string, { codice: string; testo: string; avviso: string | null; scritto?: string | null }[]>; avvisi: Record<string, string>;
  anomalie: { codice: string; riga: number | null; motivo: string; suggerito: string | null }[];
}
interface Matrice {
  modelli: { modello: string; schede: number }[];
  modello: string;
  termini: string[];
  etichette?: Record<string, string>;
  descrizioni_proposte?: { codice: string; descrizione: string }[];
  nuove: { codice: string }[];
  proposte: unknown[];
  righe: Riga[];
}

const etichetta = (m: { etichette?: Record<string, string> }, t: string) => m.etichette?.[t] ? `${m.etichette[t]} (${t})` : t;
const btnLink = 'flex items-center gap-1.5 text-sm border border-gray-200 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50';

export default function VederePage() {
  const { canManage } = useAuth();
  const puoGestire = canManage('ferrari_schede');
  const [modello, setModello] = useState('');
  const [m, setM] = useState<Matrice | null>(null);
  const [cartella, setCartella] = useState<StatoCartella | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [occupato, setOccupato] = useState(false);
  const [fCommessa, setFCommessa] = useState('');
  const [fTesto, setFTesto] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const carica = useCallback(async (mod: string) => {
    try {
      const r = await api.get<Matrice>(`/api/ferrari/matrice?modello=${encodeURIComponent(mod)}`);
      setM(r);
      setModello(r.modello);
      setErrore(null);
    } catch (e) {
      setErrore((e as Error).message);
    }
  }, []);

  const caricaCartella = useCallback(async () => {
    try { setCartella(await api.get<StatoCartella>('/api/ferrari/cartella')); } catch { /* la cartella e' un di piu' */ }
  }, []);

  useEffect(() => { carica(''); caricaCartella(); }, [carica, caricaCartella]);

  // mentre la cartella viene letta si controlla lo stato; a fine lettura la tabella si aggiorna da sola
  const inCorso = !!cartella?.in_corso;
  useEffect(() => {
    if (!inCorso) return;
    const t = setInterval(caricaCartella, 2000);
    return () => clearInterval(t);
  }, [inCorso, caricaCartella]);
  const ultimaLettura = cartella?.letture[0]?.id;
  useEffect(() => { if (ultimaLettura) carica(modello); }, [ultimaLettura]); // eslint-disable-line react-hooks/exhaustive-deps

  async function invia(files: File[]) {
    if (files.length === 0) return;
    setOccupato(true);
    try {
      const r = await inviaFile<{ risultati: { filename: string; stato?: string; duplicato?: boolean; motivo?: string; errore?: string }[] }>('/api/ferrari/files', 'files', files);
      setMsg(r.risultati.map(x => x.errore ? `${x.filename}: ${x.errore}` : x.stato === 'QUARANTENA' ? `${x.filename}: non è una scheda (${x.motivo})`
        : x.duplicato ? `${x.filename}: già caricata` : `${x.filename}: caricata`).join(' · '));
      await carica(modello);
    } catch (e) {
      setErrore((e as Error).message);
    } finally {
      setOccupato(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function leggiCartella() {
    try {
      await api.post('/api/ferrari/cartella/leggi', {});
      setErrore(null);
      await caricaCartella();
    } catch (e) {
      setErrore((e as Error).message);
    }
  }

  const righe = useMemo(() => {
    if (!m) return [];
    const c = fCommessa.trim().toLowerCase();
    const t = fTesto.trim().toLowerCase();
    return m.righe.filter(r => {
      if (c && !r.commessa.toLowerCase().includes(c)) return false;
      if (t && !m.termini.some(x => `${x} ${r.celle[x] ?? ''} ${(r.sub?.[x] ?? []).map(s => `${s.codice} ${s.testo}`).join(' ')}`.toLowerCase().includes(t))) return false;
      return true;
    });
  }, [m, fCommessa, fTesto]);

  async function esportaExcel() {
    if (!m) return;
    const XLSX = await import('xlsx');
    const dati = righe.map(r => {
      const out: Record<string, string> = { Commessa: r.commessa, Modello: r.modello ?? '' };
      for (const t of m.termini) out[etichetta(m, t)] = [r.celle[t] ?? '', ...(r.sub?.[t] ?? []).map(s => `${s.codice}: ${s.testo}`)].filter(Boolean).join('\n');
      return out;
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dati), 'Programma Produzione');
    XLSX.writeFile(wb, `programma-produzione-schede-${m.modello}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  const daFare = (m?.nuove.length ?? 0) + (m?.proposte.length ?? 0) + (m?.descrizioni_proposte?.length ?? 0);
  const vuoto = !m || m.modelli.length === 0;

  return (
    <div>
      <div className="mb-6 flex items-start justify-between flex-wrap gap-3 d-print-none">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Programma produzione (schede)</h1>
          <InfoCartella stato={cartella} />
        </div>
        <div className="flex gap-2 flex-wrap">
          {puoGestire && (
            <>
              <input ref={inputRef} type="file" multiple accept=".xls,.xlsx" className="hidden" onChange={e => invia(Array.from(e.target.files ?? []))} />
              <button className="flex items-center gap-1.5 text-sm bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                disabled={occupato} onClick={() => inputRef.current?.click()}>{occupato ? 'Caricamento…' : 'Carica Excel'}</button>
              {cartella?.config.percorso && (
                <button className={btnLink} disabled={inCorso} onClick={leggiCartella} title={`Legge ${cartella.config.percorso}`}>{inCorso ? 'Lettura…' : 'Leggi cartella'}</button>
              )}
            </>
          )}
          <button className={btnLink} disabled={!m || righe.length === 0} onClick={esportaExcel}>Scarica Excel</button>
          <button className={btnLink} onClick={() => window.print()}>Stampa</button>
          {puoGestire && (
            <Link href="/ferrari/impostazioni" className={btnLink}>
              Impostazioni
              {daFare > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-[11px] font-bold leading-4 text-white">{daFare}</span>}
            </Link>
          )}
        </div>
      </div>

      <Errore messaggio={errore} />
      {msg && <p className="d-print-none mb-3 text-xs text-gray-500">{msg}</p>}

      {puoGestire && daFare > 0 && (
        <div className="d-print-none mb-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-2.5 text-sm text-blue-800">
          {(m?.nuove.length ?? 0) > 0 && <><b>{m!.nuove.length}</b> sigle da decidere. </>}
          {(m?.descrizioni_proposte?.length ?? 0) > 0 && <><b>{m!.descrizioni_proposte!.length}</b> descrizioni da confermare. </>}
          {(m?.proposte.length ?? 0) > 0 && <><b>{m!.proposte.length}</b> modifiche dalla PC IA. </>}
          <Link href="/ferrari/impostazioni#sigle" className="font-semibold underline">Vai alle Impostazioni</Link>
        </div>
      )}

      <VistaToggle />

      {!vuoto && (
        <div className="d-print-none mb-4 flex flex-wrap items-center gap-2">
          <select className="input !w-auto" value={modello} onChange={e => { setModello(e.target.value); carica(e.target.value); }}>
            {m?.modelli.map(x => <option key={x.modello} value={x.modello}>{x.modello} ({x.schede})</option>)}
          </select>
          <input className="input !w-48" placeholder="Commessa…" value={fCommessa} onChange={e => setFCommessa(e.target.value)} />
          <input className="input !w-56" placeholder="Sigla o caratteristica…" value={fTesto} onChange={e => setFTesto(e.target.value)} />
          <span className="text-sm text-gray-500">{righe.length === (m?.righe.length ?? 0) ? `${righe.length} commesse` : `${righe.length} di ${m?.righe.length} commesse`}</span>
        </div>
      )}

      <div className="print-a4">
        <div className="only-print mb-4 text-center">
          <h1 className="text-2xl font-bold text-gray-900">Programma produzione (schede)</h1>
          <p className="text-gray-500">Modello {m?.modello}</p>
        </div>

        {vuoto ? (
          <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
            <p className="text-base font-semibold text-gray-700">Non c&apos;è ancora nessuna scheda</p>
            {puoGestire && <p className="mt-1">Premi «Carica Excel», oppure scegli la cartella degli Excel nelle <Link href="/ferrari/impostazioni#cartella" className="text-blue-600 hover:underline">Impostazioni</Link>.</p>}
          </div>
        ) : m!.termini.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
            Per {m!.modello} non hai ancora scelto nessuna sigla da mostrare.{' '}
            {puoGestire && <Link href="/ferrari/impostazioni#sigle" className="text-blue-600 hover:underline">Scegli le sigle</Link>}
          </div>
        ) : righe.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-400">Nessuna commessa trovata</div>
        ) : (
          <div className="overflow-auto max-h-[75vh] rounded-xl border border-gray-200 bg-white print:max-h-none print:overflow-visible print:border-0">
            <table className="w-full text-sm operator-sheet">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
                  <th className="sticky top-0 left-0 z-20 bg-gray-50 py-2.5 px-4 text-left font-medium">Commessa</th>
                  {m!.termini.map(t => <th key={t} className="sticky top-0 z-10 bg-gray-50 py-2.5 px-4 text-left font-medium min-w-[140px]">{etichetta(m!, t)}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {righe.map(r => (
                  <tr key={r.id} className="align-top hover:bg-gray-50">
                    <td className="sticky left-0 z-10 bg-white py-2 px-4 font-semibold whitespace-nowrap">
                      <Link href={`/ferrari/${r.id}`} className="text-blue-600 hover:underline print:text-black">{r.commessa}</Link>
                      <div className="d-print-none font-normal"><AnomalieRiga anomalie={r.anomalie} modello={m!.modello} onFatto={() => carica(modello)} onErrore={setErrore} /></div>
                    </td>
                    {m!.termini.map(t => (
                      <td key={t} className={`py-2 px-4 max-w-[280px] ${r.rivedere?.[t] ? 'shadow-[inset_3px_0_0_#f0a020]' : ''}`}>
                        {r.avvisi?.[t] && <div className="text-xs font-semibold text-amber-700">{r.avvisi[t]}</div>}
                        <Cella testo={r.celle[t]} intero={r.testi[t]} />
                        {r.sub?.[t]?.map(x => <SottoSigla key={x.codice} x={x} modello={m!.modello} onFatto={() => carica(modello)} onErrore={setErrore} />)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 10mm; }
          .d-print-none { display: none !important; }
          .operator-sheet { font-size: 8pt; }
        }
      `}</style>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { inviaFile } from '@/lib/ferrari';
import { AnomalieRiga, Cella, Errore, FerrariNav, SottoSigla, VistaToggle } from '@/components/ferrari/Comuni';
import { InfoCartella, type StatoCartella } from '@/components/ferrari/InfoCartella';

interface Riga {
  id: number; commessa: string; modello: string | null; paese: string | null; stato: string;
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

const DEFAULT_MAX = '200';
const etichetta = (m: { etichette?: Record<string, string> }, t: string) => m.etichette?.[t] ? `${m.etichette[t]} (${t})` : t;
const btnBase      = 'inline-flex items-center gap-1 text-sm font-medium px-3 py-2 rounded-lg transition-colors';
const btnPrimary   = `${btnBase} bg-blue-600 text-white hover:bg-blue-700`;
const btnSecondary = `${btnBase} bg-white border border-gray-200 text-gray-700 hover:bg-gray-50`;
const inputClass   = 'border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

function Campo({ label, highlight, children }: { label: string; highlight?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className={`text-xs font-medium ${highlight ? 'text-blue-700' : 'text-gray-400'}`}>{label}</label>
      {children}
    </div>
  );
}

export default function VederePage() {
  const { canManage } = useAuth();
  const puoGestire = canManage('ferrari_schede');
  const [modello, setModello] = useState('');
  const [m, setM] = useState<Matrice | null>(null);
  const [cartella, setCartella] = useState<StatoCartella | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [msg, setMsg] = useState<string[]>([]);
  const [occupato, setOccupato] = useState(false);
  const [fCommessa, setFCommessa] = useState('');
  const [fTesto, setFTesto] = useState('');
  const [fMax, setFMax] = useState(DEFAULT_MAX);
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
    try { setCartella(await api.get<StatoCartella>('/api/ferrari/cartella')); } catch { /* la cartella e' un di piu': la tabella funziona anche senza */ }
  }, []);

  useEffect(() => { carica(''); caricaCartella(); }, [carica, caricaCartella]);

  // mentre la cartella viene letta si controlla lo stato; a fine lettura la tabella si aggiorna da sola
  const inCorso = !!cartella?.in_corso;
  useEffect(() => {
    if (!inCorso) return;
    const t = setInterval(async () => {
      await caricaCartella();
    }, 2000);
    return () => clearInterval(t);
  }, [inCorso, caricaCartella]);
  const ultimaLettura = cartella?.letture[0]?.id;
  useEffect(() => { if (ultimaLettura) carica(modello); /* nuova lettura: nuove commesse */ }, [ultimaLettura]); // eslint-disable-line react-hooks/exhaustive-deps

  async function invia(files: File[]) {
    if (files.length === 0) return;
    setOccupato(true);
    try {
      const r = await inviaFile<{ risultati: { filename: string; stato?: string; duplicato?: boolean; motivo?: string; errore?: string }[] }>('/api/ferrari/files', 'files', files);
      setMsg(r.risultati.map(x => x.errore ? `${x.filename}: ${x.errore}` : x.stato === 'QUARANTENA' ? `${x.filename}: non è una scheda (${x.motivo})`
        : x.duplicato ? `${x.filename}: già caricata` : `${x.filename}: caricata`));
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
    const filtrate = m.righe.filter(r => {
      if (c && !r.commessa.toLowerCase().includes(c)) return false;
      if (t && !m.termini.some(x => `${x} ${r.celle[x] ?? ''} ${(r.sub?.[x] ?? []).map(s => `${s.codice} ${s.testo}`).join(' ')}`.toLowerCase().includes(t))) return false;
      return true;
    });
    const max = parseInt(fMax, 10);
    return fMax.trim() && Number.isFinite(max) && max > 0 ? filtrate.slice(0, max) : filtrate;
  }, [m, fCommessa, fTesto, fMax]);

  const filtriAttivi = !!(fCommessa || fTesto || fMax !== DEFAULT_MAX);

  async function esportaExcel() {
    if (!m) return;
    const XLSX = await import('xlsx');
    const dati = righe.map((r, i) => {
      const out: Record<string, string | number> = { '#': i + 1, Commessa: r.commessa, Modello: r.modello ?? '' };
      for (const t of m.termini) {
        const sub = (r.sub?.[t] ?? []).map(s => `${s.codice}: ${s.testo}`);
        out[etichetta(m, t)] = [r.celle[t] ?? '', ...sub].filter(Boolean).join('\n');
      }
      return out;
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dati), 'Programma Produzione');
    XLSX.writeFile(wb, `programma-produzione-schede-${m.modello}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  const daFare = (m?.nuove.length ?? 0) + (m?.proposte.length ?? 0) + (m?.descrizioni_proposte?.length ?? 0);

  return (
    <div>
      <FerrariNav badge={puoGestire ? daFare : 0} />
      <Errore messaggio={errore} />

      {/* ── Titolo, azioni e filtri in un'unica card, come il foglio di Programma Produzione ── */}
      <div className="d-print-none bg-white rounded-xl border border-gray-200 p-5 mb-6 space-y-4">
        <div className="flex items-start justify-between flex-wrap gap-3 pb-4 border-b border-gray-100">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Programma Produzione</p>
              {m?.modello && <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-600">{m.modello}</span>}
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mt-1">Programma produzione (schede)</h1>
            <InfoCartella stato={cartella} />
          </div>
          <div className="flex flex-wrap gap-2">
            <VistaToggle />
            {puoGestire && (
              <>
                <input ref={inputRef} type="file" multiple accept=".xls,.xlsx" className="hidden" onChange={e => invia(Array.from(e.target.files ?? []))} />
                <button className={btnSecondary} disabled={occupato} onClick={() => inputRef.current?.click()}>{occupato ? 'Caricamento…' : 'Carica Excel'}</button>
                <button className={btnSecondary} disabled={inCorso || !cartella?.config.percorso} onClick={leggiCartella}
                  title={cartella?.config.percorso ? `Legge ${cartella.config.percorso}` : 'Prima scegli la cartella nelle Impostazioni'}>
                  {inCorso ? 'Lettura in corso…' : 'Leggi cartella ora'}
                </button>
              </>
            )}
            <button className={btnSecondary} disabled={!m || righe.length === 0} onClick={esportaExcel}>📥 Scarica Excel</button>
            <button className={btnPrimary} onClick={() => window.print()}>🖨️ Stampa</button>
          </div>
        </div>
        {msg.length > 0 && <p className="text-xs text-gray-500">{msg.join(' · ')}</p>}

        {puoGestire && daFare > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm">
            {(m?.nuove.length ?? 0) > 0 && <><b>{m!.nuove.length}</b> sigle da decidere per {m!.modello}. </>}
            {(m?.descrizioni_proposte?.length ?? 0) > 0 && <><b>{m!.descrizioni_proposte!.length}</b> colonne senza descrizione: le schede la hanno, vuoi aggiungerla? </>}
            {(m?.proposte.length ?? 0) > 0 && <><b>{m!.proposte.length}</b> modifiche dalla PC IA da accettare. </>}
            <Link href="/ferrari/impostazioni#sigle" className="font-semibold text-blue-700 hover:underline">Vai alle Impostazioni →</Link>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="text-sm font-semibold text-gray-700">Filtri</h2>
            <div className="flex items-center gap-3">
              <p className="text-xs text-gray-400">Mostrando <span className="font-medium text-gray-600">{righe.length}</span> di {m?.righe.length ?? 0} commesse</p>
              {filtriAttivi && <button className={btnSecondary} onClick={() => { setFCommessa(''); setFTesto(''); setFMax(DEFAULT_MAX); }}>Cancella filtri</button>}
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Campo label="Modello">
              <select className={`${inputClass} bg-white`} value={modello} onChange={e => { setModello(e.target.value); carica(e.target.value); }}>
                {m?.modelli.map(x => <option key={x.modello} value={x.modello}>{x.modello} ({x.schede})</option>)}
              </select>
            </Campo>
            <Campo label="Commessa">
              <input className={inputClass} value={fCommessa} onChange={e => setFCommessa(e.target.value)} placeholder="Es. 100001" />
            </Campo>
            <Campo label="Sigla / caratteristica">
              <input className={inputClass} value={fTesto} onChange={e => setFTesto(e.target.value)} placeholder="Es. LIVR o Pelle nera" />
            </Campo>
            <Campo label="Righe da mostrare" highlight>
              <input value={fMax} onChange={e => setFMax(e.target.value)} type="number" min={1} placeholder="Tutte"
                title="Numero massimo di righe da mostrare/stampare — vuoto = tutte"
                className="w-full border border-blue-200 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-blue-900 bg-blue-50 text-center focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </Campo>
          </div>
        </div>
      </div>

      {/* ── Parte stampabile ── */}
      <div className="print-a4" style={{ fontSize: '0.78rem' }}>
        <div className="only-print mb-4 text-center">
          <h1 className="text-2xl font-bold text-gray-900">Programma produzione (schede)</h1>
          <p className="text-gray-500">Modello <span className="text-red-600 font-medium">{m?.modello}</span></p>
        </div>

        {!m || m.modelli.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
            <b className="text-base text-gray-700">Benvenuto: non c&apos;è ancora nessuna scheda.</b>
            {puoGestire && (
              <ol className="mx-auto mt-3 max-w-md space-y-1 text-left text-sm">
                <li><b>1.</b> Premi «Carica Excel» (o scegli la cartella nelle Impostazioni → Cartella Excel).</li>
                <li><b>2.</b> Aspetta che la lettura finisca.</li>
                <li><b>3.</b> Vai in Impostazioni (ingranaggio in alto a destra) → Sigle e scegli quali sigle vuoi come colonne.</li>
                <li><b>4.</b> Torna qui: una riga per commessa e una colonna per sigla.</li>
              </ol>
            )}
          </div>
        ) : m.termini.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-500">
            Nessuna sigla scelta per {m.modello}. {puoGestire && <Link href="/ferrari/impostazioni#sigle" className="text-blue-700 hover:underline">Scegli le sigle nelle Impostazioni</Link>}
          </div>
        ) : righe.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">Nessuna commessa trovata</div>
        ) : (
          <div className="overflow-auto max-h-[75vh] print:max-h-none print:overflow-visible">
            <table className="w-full text-sm border-separate border-spacing-0 operator-sheet">
              <thead>
                <tr className="bg-gray-100">
                  <th className="sticky top-0 z-10 bg-gray-100 border border-gray-300 px-2 py-1.5">#</th>
                  <th className="sticky top-0 z-10 bg-gray-100 border border-gray-300 px-2 py-1.5 text-left">Commessa</th>
                  {m.termini.map(t => <th key={t} className="sticky top-0 z-10 bg-gray-100 border border-gray-300 px-2 py-1.5 text-left min-w-[130px]">{etichetta(m, t)}</th>)}
                </tr>
              </thead>
              <tbody>
                {righe.map((r, i) => (
                  <tr key={r.id} className="bg-white hover:bg-gray-50 align-top">
                    <td className="border border-gray-200 px-2 py-1 text-center">{i + 1}</td>
                    <td className="border border-gray-200 px-2 py-1 font-mono font-semibold whitespace-nowrap">
                      <Link href={`/ferrari/${r.id}`} className="text-blue-700 hover:underline print:text-black">{r.commessa}</Link>
                      <div className="d-print-none font-normal"><AnomalieRiga anomalie={r.anomalie} modello={m.modello} onFatto={() => carica(modello)} onErrore={setErrore} /></div>
                    </td>
                    {m.termini.map(t => (
                      <td key={t} className={`border border-gray-200 px-2 py-1 max-w-[260px] ${r.rivedere?.[t] ? 'shadow-[inset_3px_0_0_#f0a020]' : ''}`}>
                        {r.rivedere?.[t] && <div className="text-xs font-semibold text-amber-700" title="Da controllare">⚠ da rivedere</div>}
                        {r.avvisi?.[t] && <div className="text-xs font-semibold text-amber-700">⚠ {r.avvisi[t]}</div>}
                        <Cella testo={r.celle[t]} intero={r.testi[t]} />
                        {r.sub?.[t]?.map(x => <SottoSigla key={x.codice} x={x} modello={m.modello} onFatto={() => carica(modello)} onErrore={setErrore} />)}
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

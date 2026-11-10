'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { inviaFile } from '@/lib/ferrari';
import { iaApi, leggiRiprova, STATI_IN_CORSO, type StatoIa } from '@/lib/ferrari-ia';
import { AnomalieRiga, Cella, Errore, SottoSigla, VistaToggle } from '@/components/ferrari/Comuni';
import type { StatoCartella } from '@/components/ferrari/InfoCartella';
import { PageHeader } from '@/components/ui/PageHeader';
import { IconSettings } from '@/components/icons/ModuleIcons';

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
  gruppi?: { categoria: string | null; termini: string[] }[];     // colonne per categoria ([] se non ce ne sono)
  etichette?: Record<string, string>;
  descrizioni_proposte?: { codice: string; descrizione: string }[];
  nuove: { codice: string }[];
  proposte: unknown[];
  righe: Riga[];
}

const btnLink = 'btn-secondary';

export default function VederePage() {
  const { canManage } = useAuth();
  const puoGestire = canManage('ferrari_schede');
  const [modello, setModello] = useState('');
  const [m, setM] = useState<Matrice | null>(null);
  const [cartella, setCartella] = useState<StatoCartella | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [ia, setIa] = useState<StatoIa | null>(null);
  const [msg, setMsg] = useState('');
  const [occupato, setOccupato] = useState(false);
  const [riprova, setRiprova] = useState(false);             // modalita' prova (Impostazioni, Avanzate): un file gia' caricato si rimanda alla IA
  useEffect(() => { setRiprova(leggiRiprova()); }, []);
  const [trascina, setTrascina] = useState(false);           // un file e' sopra la pagina: si mostra dove rilasciarlo
  const trascinando = useRef(0);                             // dragenter/dragleave scattano anche sugli elementi interni
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
  // stato dell'analisi IA (solo il pallino accanto a «Elaborazione»): si aggiorna ogni 10 secondi
  useEffect(() => {
    const leggi = () => iaApi.stato().then(setIa).catch(() => {});
    leggi();
    const t = setInterval(leggi, 10_000);
    return () => clearInterval(t);
  }, []);

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
      const prova = leggiRiprova();                          // si rilegge al momento: la casella e' in un'altra pagina
      const r = await inviaFile<{ risultati: { filename: string; stato?: string; duplicato?: boolean; motivo?: string; errore?: string; riprova?: string }[] }>(
        `/api/ferrari/files${prova ? '?riprova=1' : ''}`, 'files', files);
      const giaCaricata = (x: { riprova?: string }) => x.riprova === 'accodata' ? 'già caricata, rimandata alla IA'
        : x.riprova === 'gia_in_corso' ? 'già caricata, analisi IA già in corso'
        : x.riprova === 'ia_spenta' ? 'già caricata (IA spenta: niente da rimandare)'
        : x.riprova === 'non_analizzabile' ? 'già caricata (versione sostituita: non si analizza)'
        : 'già caricata';
      setMsg(r.risultati.map(x => x.errore ? `${x.filename}: ${x.errore}` : x.stato === 'QUARANTENA' ? `${x.filename}: non è una scheda (${x.motivo})`
        : x.duplicato ? `${x.filename}: ${giaCaricata(x)}` : `${x.filename}: caricata`).join(' · '));
      await carica(modello);
    } catch (e) {
      setErrore((e as Error).message);
    } finally {
      setOccupato(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  // Un file lasciato per sbaglio fuori dall'area della pagina (per esempio sul menu) non deve farsi aprire dal browser
  useEffect(() => {
    if (!puoGestire) return;
    const blocca = (e: DragEvent) => { if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) e.preventDefault(); };
    window.addEventListener('dragover', blocca);
    window.addEventListener('drop', blocca);
    return () => { window.removeEventListener('dragover', blocca); window.removeEventListener('drop', blocca); };
  }, [puoGestire]);

  // Trascinare uno o piu' file Excel sulla pagina li carica (come «Carica Excel»)
  const haFile = (e: React.DragEvent) => puoGestire && Array.from(e.dataTransfer?.types ?? []).includes('Files');
  function rilascia(e: React.DragEvent) {
    if (!haFile(e)) return;
    e.preventDefault();
    trascinando.current = 0;
    setTrascina(false);
    if (occupato) return;
    const tutti = Array.from(e.dataTransfer.files);
    const excel = tutti.filter(f => /\.(xls|xlsx)$/i.test(f.name));
    if (excel.length === 0) { setErrore('Trascina file Excel (.xls o .xlsx)'); return; }
    setErrore(null);
    if (excel.length < tutti.length) setMsg(`${tutti.length - excel.length} file ignorati: non sono Excel`);
    invia(excel);
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

  // colonne nell'ordine delle categorie (senza categorie: com'erano); la prima colonna di ogni gruppo ha un filo di separazione
  const gruppi = m?.gruppi ?? [];
  const raggruppata = gruppi.length > 0;
  const colonne = useMemo(() => raggruppata ? gruppi.flatMap(g => g.termini) : (m?.termini ?? []), [raggruppata, gruppi, m?.termini]);
  const inizioGruppo = useMemo(() => new Set(raggruppata ? gruppi.map(g => g.termini[0]) : []), [raggruppata, gruppi]);

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
    // Stessa intestazione della tabella: categoria (se ce ne sono), sigla e sotto la descrizione. Le prime due colonne sono Commessa e Modello.
    const PRIME = 2;
    const intestazione: string[][] = [];
    const unioni: import('xlsx').Range[] = [];
    if (raggruppata) {
      const riga = ['Commessa', 'Modello', ...colonne.map(() => '')];
      let c = PRIME;
      for (const g of gruppi) {
        riga[c] = g.categoria ?? 'Altre';
        if (g.termini.length > 1) unioni.push({ s: { r: 0, c }, e: { r: 0, c: c + g.termini.length - 1 } });
        c += g.termini.length;
      }
      intestazione.push(riga);
    }
    intestazione.push([raggruppata ? '' : 'Commessa', raggruppata ? '' : 'Modello', ...colonne]);
    intestazione.push(['', '', ...colonne.map(t => m.etichette?.[t] ?? '')]);
    for (const c of [0, 1]) unioni.push({ s: { r: 0, c }, e: { r: intestazione.length - 1, c } });   // Commessa e Modello occupano tutta l'intestazione
    const dati = righe.map(r => [r.commessa, r.modello ?? '',
      ...colonne.map(t => [r.celle[t] ?? '', ...(r.sub?.[t] ?? []).map(x => `${x.codice}: ${x.testo}`)].filter(Boolean).join('\n'))]);
    const foglio = XLSX.utils.aoa_to_sheet([...intestazione, ...dati]);
    foglio['!merges'] = unioni;
    foglio['!cols'] = [{ wch: 12 }, { wch: 10 }, ...colonne.map(() => ({ wch: 28 }))];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, foglio, 'Programma Produzione');
    XLSX.writeFile(wb, `programma-produzione-schede-${m.modello}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  const daFare = (m?.nuove.length ?? 0) + (m?.proposte.length ?? 0) + (m?.descrizioni_proposte?.length ?? 0);
  const vuoto = !m || m.modelli.length === 0;

  return (
    <div
      onDragEnter={e => { if (haFile(e)) { e.preventDefault(); trascinando.current++; setTrascina(true); } }}
      onDragOver={e => { if (haFile(e)) e.preventDefault(); }}
      onDragLeave={e => { if (haFile(e) && --trascinando.current <= 0) { trascinando.current = 0; setTrascina(false); } }}
      onDrop={rilascia}
    >
      {trascina && (
        <div className="d-print-none pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-white/80 p-6" role="status" aria-live="polite">
          <div className="rounded-card border-2 border-dashed border-accent bg-white px-10 py-8 text-center shadow-float">
            <p className="text-base font-semibold text-ink">Rilascia i file Excel per caricarli</p>
            <p className="mt-1 text-sm text-muted">.xls o .xlsx{riprova ? ' · i file già caricati vengono rimandati alla IA' : ''}</p>
          </div>
        </div>
      )}
      <PageHeader
        title="Programma produzione (schede)"
        actions={
          <>
            {puoGestire && (
              <>
                <input ref={inputRef} type="file" multiple accept=".xls,.xlsx" className="hidden" onChange={e => invia(Array.from(e.target.files ?? []))} />
                <button className="btn-primary"
                  disabled={occupato} onClick={() => inputRef.current?.click()}>{occupato ? 'Caricamento…' : 'Carica Excel'}</button>
                {cartella?.config.percorso && (
                  <button className={btnLink} disabled={inCorso} onClick={leggiCartella} title={`Legge ${cartella.config.percorso}`}>{inCorso ? 'Lettura…' : 'Leggi cartella'}</button>
                )}
              </>
            )}
            <Link href="/ferrari/elaborazione" className={btnLink} title={ia ? (ia.config.attiva ? (ia.connessione.stato === 'non_raggiungibile' ? 'PC IA non raggiungibile' : 'Analisi con IA accesa') : 'Analisi con IA spenta') : undefined}>
              <span className={`h-2 w-2 rounded-full ${!ia || !ia.config.attiva ? 'bg-stone-300' : ia.connessione.stato === 'non_raggiungibile' ? 'bg-amber-500' : 'bg-green-600'}`} aria-hidden />
              Elaborazione
              {ia && Object.entries(ia.contatori).filter(([k]) => STATI_IN_CORSO.includes(k)).reduce((a, [, n]) => a + n, 0) > 0 && (
                <span className="rounded-full bg-accent px-1.5 text-[11px] font-bold leading-4 text-white">{Object.entries(ia.contatori).filter(([k]) => STATI_IN_CORSO.includes(k)).reduce((a, [, n]) => a + n, 0)}</span>
              )}
            </Link>
            <button className={btnLink} disabled={!m || righe.length === 0} onClick={esportaExcel}>Scarica Excel</button>
            <button className={btnLink} onClick={() => window.print()}>Stampa</button>
            {puoGestire && (
              <Link href="/ferrari/impostazioni" className={`${btnLink} group-gear`}>
              <IconSettings className="gear h-4 w-4" />                Impostazioni
                {daFare > 0 && <span className="rounded-full bg-brand px-1.5 text-[11px] font-bold leading-4 text-white">{daFare}</span>}
              </Link>
            )}
          </>
        }
      />

      <Errore messaggio={errore} />
      {msg && <p className="d-print-none mb-3 text-xs text-muted">{msg}</p>}

      {puoGestire && daFare > 0 && (
        <div className="d-print-none mb-4 rounded-card border border-accent/40 bg-accent-soft px-4 py-2.5 text-sm text-accent-ink">
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
          <span className="text-sm text-muted">{righe.length === (m?.righe.length ?? 0) ? `${righe.length} commesse` : `${righe.length} di ${m?.righe.length} commesse`}</span>
        </div>
      )}

      <div className="print-a4">
        <div className="only-print mb-4 text-center">
          <h1 className="text-2xl font-bold text-ink-900">Programma produzione (schede)</h1>
          <p className="text-muted">Modello {m?.modello}</p>
        </div>

        {vuoto ? (
          <div className="rounded-card border border-line bg-white p-10 text-center text-sm text-muted">
            <p className="text-base font-semibold text-ink-700">Non c&apos;è ancora nessuna scheda</p>
            {puoGestire && <p className="mt-1">Premi «Carica Excel», oppure scegli la cartella degli Excel nelle <Link href="/ferrari/impostazioni#cartella" className="text-accent-ink hover:underline">Impostazioni</Link>.</p>}
          </div>
        ) : m!.termini.length === 0 ? (
          <div className="rounded-card border border-line bg-white p-10 text-center text-sm text-muted">
            Per {m!.modello} non hai ancora scelto nessuna sigla da mostrare.{' '}
            {puoGestire && <Link href="/ferrari/impostazioni#sigle" className="text-accent-ink hover:underline">Scegli le sigle</Link>}
          </div>
        ) : righe.length === 0 ? (
          <div className="rounded-card border border-line bg-white p-10 text-center text-sm text-muted">Nessuna commessa trovata</div>
        ) : (
          <div className="overflow-auto max-h-[75vh] rounded-card border border-line bg-white print:max-h-none print:overflow-visible print:border-0">
            <table className="w-full text-sm operator-sheet">
              <thead>
                {raggruppata && (
                  <tr className="bg-stone-50 text-muted">
                    <th rowSpan={2} className="sticky top-0 left-0 z-20 bg-stone-50 py-2.5 px-4 text-left font-medium">Commessa</th>
                    {gruppi.map(g => (
                      <th key={g.categoria ?? '_altre'} colSpan={g.termini.length}
                        className="sticky top-0 z-10 h-8 border-l border-line bg-stone-50 px-4 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-ink-700">
                        {g.categoria ?? 'Altre'}
                      </th>
                    ))}
                  </tr>
                )}
                <tr className="border-b border-line bg-stone-50 text-muted">
                  {!raggruppata && <th className="sticky top-0 left-0 z-20 bg-stone-50 py-2.5 px-4 text-left font-medium">Commessa</th>}
                  {colonne.map(t => <th key={t} className={`sticky ${raggruppata ? 'top-8' : 'top-0'} z-10 bg-stone-50 py-2.5 px-4 text-left font-medium min-w-[140px] ${inizioGruppo.has(t) ? 'border-l border-line' : ''}`}>
                    <span className="font-semibold text-ink-900">{t}</span>
                    {m!.etichette?.[t] && <span className="block text-xs font-normal leading-snug text-muted">{m!.etichette[t]}</span>}
                  </th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {righe.map(r => (
                  <tr key={r.id} className="align-top hover:bg-stone-50">
                    <td className="sticky left-0 z-10 bg-white py-2 px-4 font-semibold whitespace-nowrap">
                      <Link href={`/ferrari/${r.id}`} className="text-accent-ink hover:underline print:text-black">{r.commessa}</Link>
                      <div className="d-print-none font-normal"><AnomalieRiga anomalie={r.anomalie} modello={m!.modello} onFatto={() => carica(modello)} onErrore={setErrore} /></div>
                    </td>
                    {colonne.map(t => (
                      <td key={t} className={`py-2 px-4 max-w-[280px] ${inizioGruppo.has(t) ? 'border-l border-line' : ''} ${r.rivedere?.[t] ? 'shadow-[inset_3px_0_0_#f0a020]' : ''}`}>
                        {r.avvisi?.[t] && <div className="text-xs font-semibold text-warning">{r.avvisi[t]}</div>}
                        <Cella testo={r.celle[t]} intero={r.testi[t]} compatta />
                        {r.sub?.[t]?.map(x => <SottoSigla key={x.codice} x={x} modello={m!.modello} onFatto={() => carica(modello)} onErrore={setErrore} compatta />)}
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

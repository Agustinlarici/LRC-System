'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Errore } from '@/components/ferrari/Comuni';

type Stato = 'colonna' | 'sub' | 'no' | 'alias' | 'nonsigla' | 'da_decidere';
interface StatoModello {
  stato: Stato; ambito: 'modello' | 'tutti' | null; alias: string | null; sub?: boolean; simile_a?: string | null; padre?: string | null;
  auto?: boolean; suggerimento?: string;
}
interface Voce {
  codice: string; nome: string; esempio: string; tutti: Stato | null; alias: string | null;
  descrizione: string | null; descrizione_proposta: string | null; stati: Record<string, StatoModello>;
}
export interface ConfigSigle {
  modelli: { modello: string; schede: number }[];
  sigle: Voce[];
  da_decidere: Record<string, number>;
  gestione_modelli: { nuovi: { modello: string }[] };
  proposte_sigle: unknown[];
  descrizioni_da_confermare: number;
}
type Filtro = 'tutte' | 'da' | 'si' | 'no' | 'ns';

const NOME_STATO: Record<string, string> = { colonna: 'Sì', sub: 'Sotto-sigla', no: 'Non mi serve', nonsigla: 'Non è una sigla', alias: 'Errore di scrittura', da_decidere: 'da decidere' };

// Stato di una sigla su tutti i modelli: se sono d'accordo quello, altrimenti «misto» (o da decidere se manca anche solo una scelta)
function sintesi(s: Voce) {
  const xs = Object.values(s.stati);
  const stati = [...new Set(xs.map(x => x.stato))];
  const primo = <K extends keyof StatoModello>(k: K) => xs.find(x => x[k])?.[k] ?? null;
  const st: string = s.tutti ?? (stati.length === 1 ? stati[0]! : stati.includes('da_decidere') ? 'da_decidere' : 'misto');
  return {
    stato: st, alias: (s.alias || primo('alias')) as string | null, padre: primo('padre') as string | null, sub: xs.some(x => x.sub) || st === 'sub',
    simile_a: primo('simile_a') as string | null, auto: xs.some(x => x.auto), suggerimento: primo('suggerimento') as string | null,
  };
}

/** Impostazioni → Sigle: per ogni sigla si sceglie «Sì» (colonna), «Non mi serve» o «Non è una sigla», e a quali modelli vale. */
export function ImpostazioniSigle({ onCambia }: { onCambia?: (c: ConfigSigle) => void }) {
  const [c, setC] = useState<ConfigSigle | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [nota, setNota] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('tutte');
  const [scelto, setScelto] = useState(false);
  const [cerca, setCerca] = useState('');
  const [nuovo, setNuovo] = useState('');
  const [tipo, setTipo] = useState('colonna');
  const [scelti, setScelti] = useState<Record<string, string[]>>({});
  const [elencoAperto, setElencoAperto] = useState(false);
  const [testoElenco, setTestoElenco] = useState('');
  const [tipoElenco, setTipoElenco] = useState<'colonna' | 'sub'>('colonna');
  const cambiaRef = useRef(onCambia);                         // il chiamante passa una funzione nuova a ogni render: non deve rifare la richiesta
  cambiaRef.current = onCambia;

  const carica = useCallback(async () => {
    try {
      const r = await api.get<ConfigSigle>('/api/ferrari/impostazioni/sigle');
      setC(r);
      setErrore(null);
      cambiaRef.current?.(r);
    } catch (e) { setErrore((e as Error).message); }
  }, []);
  useEffect(() => { carica(); }, [carica]);

  // al primo ingresso si mostra subito cio' che va deciso
  const totDa = c ? Object.values(c.da_decidere).reduce((a, b) => a + b, 0) : 0;
  useEffect(() => { if (!scelto && totDa > 0) { setFiltro('da'); setScelto(true); } }, [totDa, scelto]);

  const modelliScelti = (s: Voce): string[] => {
    if (scelti[s.codice]) return scelti[s.codice]!;
    const dec = Object.entries(s.stati).filter(([, x]) => x.stato !== 'da_decidere').map(([m]) => m);
    const da = Object.values(s.stati).some(x => x.stato === 'da_decidere');
    return da || !dec.length ? Object.keys(s.stati) : dec;          // se c'e' ancora da decidere propongo tutti i modelli in cui compare
  };

  async function imposta(s: Voce, stato: string, alias?: string | null, padre?: string | null) {
    const mods = modelliScelti(s);
    if (!mods.length) { setNota('Scegli prima a quali modelli vale (colonna «Modelli»).'); return; }
    const tutti = mods.length === c!.modelli.length;
    if (tutti && Object.values(s.stati).some(y => y.ambito === 'modello') && !confirm('Questa scelta sostituisce quelle fatte per i singoli modelli. Continuare?')) return;
    try {
      await api.post('/api/ferrari/sigle/imposta', { codice: s.codice, stato, modelli: tutti ? '*' : mods, alias, padre });
      setScelti(x => { const y = { ...x }; delete y[s.codice]; return y; });
      setNota(null);
    } catch (e) { setErrore((e as Error).message); }
    await carica();
  }

  async function aggiungi() {
    if (!nuovo.trim()) { setNota('Scrivi prima la sigla o la parola da aggiungere.'); return; }
    try {
      await api.post('/api/ferrari/sigle/imposta', { codice: nuovo.trim(), stato: tipo, modelli: '*' });
      setNota(`Aggiunta ${nuovo.trim().toUpperCase()} a tutti i modelli`);
      setNuovo('');
    } catch (e) { setErrore((e as Error).message); }
    await carica();
  }

  // Caricamento massivo: un elenco di sigle (una per riga, con o senza descrizione), incollato o da file
  async function leggiFile(f: File | undefined) {
    if (!f) return;
    try {
      if (/\.xlsx?$/i.test(f.name)) {
        const XLSX = await import('xlsx');
        const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
        const righe = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]!]!, { header: 1, blankrows: false });
        setTestoElenco(righe.map(r => `${String(r[0] ?? '').trim()}\t${String(r[1] ?? '').trim()}`).filter(l => l.trim()).join('\n'));
      } else {
        setTestoElenco(await f.text());
      }
    } catch (e) { setErrore(`File non leggibile: ${(e as Error).message}`); }
  }
  async function caricaElenco() {
    try {
      const r = await api.post<{ totale: number; nuove: number; gia_presenti: number; descrizioni: number; senza_descrizione: number; ignorate: unknown[] }>(
        '/api/ferrari/sigle/elenco', { testo: testoElenco, stato: tipoElenco, modelli: '*' });
      setNota(`Elenco caricato: ${r.nuove} sigle nuove, ${r.gia_presenti} già presenti, ${r.descrizioni} descrizioni salvate`
        + (r.senza_descrizione ? ` · ${r.senza_descrizione} senza descrizione (se le schede la hanno, te la propongo)` : '')
        + (r.ignorate.length ? ` · ${r.ignorate.length} righe ignorate` : ''));
      setTestoElenco('');
      setElencoAperto(false);
      setErrore(null);
    } catch (e) { setErrore((e as Error).message); }
    await carica();
  }

  // Descrizioni: accettare/rifiutare quella delle schede o scriverla a mano
  async function descrizioni(azione: 'accetta' | 'rifiuta', codici: string[]) {
    try {
      await api.post('/api/ferrari/sigle/descrizioni', { azione, voci: codici.map(codice => ({ codice })) });
    } catch (e) { setErrore((e as Error).message); }
    await carica();
  }
  async function scriviDescrizione(s: Voce) {
    const d = (prompt(`Descrizione di ${s.codice} (compare nella colonna come «DESCRIZIONE (${s.codice})»). Lascia vuoto per non cambiare.`, s.descrizione ?? s.descrizione_proposta ?? '') ?? '').trim();
    if (!d) return;
    try {
      await api.post('/api/ferrari/sigle/descrizioni', { azione: 'imposta', voci: [{ codice: s.codice, descrizione: d }] });
    } catch (e) { setErrore((e as Error).message); }
    await carica();
  }

  async function inBlocco(stato: 'colonna' | 'no') {
    if (!c) return;
    const lista = c.modelli.map(m => m.modello).filter(m => (c.da_decidere[m] ?? 0) > 0);
    const n = lista.reduce((a, m) => a + (c.da_decidere[m] ?? 0), 0);
    if (!confirm(`${stato === 'colonna' ? `Mettere Sì a TUTTE le ${n} sigle da decidere` : `Mettere «Non mi serve» a TUTTE le ${n} sigle da decidere`} di tutti i modelli?`)) return;
    try {
      let decise = 0;
      for (const m of lista) decise += (await api.post<{ decise: number }>('/api/ferrari/sigle/da-decidere', { modello: m, stato })).decise;
      setNota(`${decise} sigle decise`);
    } catch (e) { setErrore((e as Error).message); }
    await carica();
  }

  const proposteDesc = useMemo(() => (c?.sigle ?? []).filter(x => x.descrizione_proposta), [c]);
  const tutte = useMemo(() => (c?.sigle ?? []).filter(s => Object.keys(s.stati).length > 0), [c]);
  const conta = useMemo(() => {
    const k = { da: 0, si: 0, no: 0, ns: 0 };
    for (const s of tutte) { const st = sintesi(s).stato; if (st === 'da_decidere') k.da++; else if (st === 'no') k.no++; else if (st === 'nonsigla') k.ns++; else k.si++; }
    return k;
  }, [tutte]);
  const righe = useMemo(() => tutte.filter(s => {
    if (cerca && !`${s.codice} ${s.nome}`.toLowerCase().includes(cerca.toLowerCase())) return false;
    const st = sintesi(s).stato;
    if (filtro === 'da') return st === 'da_decidere';
    if (filtro === 'si') return st !== 'da_decidere' && st !== 'no' && st !== 'nonsigla';
    if (filtro === 'no') return st === 'no';
    if (filtro === 'ns') return st === 'nonsigla';
    return true;
  }), [tutte, cerca, filtro]);

  if (!c) return <Errore messaggio={errore} />;
  if (c.modelli.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm">
        <h2 className="text-lg font-semibold">Non c&apos;è ancora nessuna scheda</h2>
        <p className="mt-1 text-gray-500">Le sigle si decidono guardando le schede. Carica uno o più Excel (o leggi la cartella) e poi torna qui: troverai l&apos;elenco delle sigle da decidere.</p>
        <Link href="/ferrari" className="btn-primary mt-3 inline-block">Vai a «Vedere»</Link>
      </div>
    );
  }
  const padriPossibili = (s: Voce, padre: string | null) => {
    const p = tutte.filter(z => z.codice !== s.codice && Object.values(z.stati).some(y => y.stato === 'colonna')).map(z => z.codice);
    if (padre && !p.includes(padre)) p.push(padre);
    return p;
  };

  return (
    <div className="space-y-3">
      <Errore messaggio={errore} />
      <div className="flex flex-wrap items-center gap-2">
        <input className="input !w-52 !py-1" placeholder="+ sigla o parola (es. BIC2)" value={nuovo} onChange={e => setNuovo(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') aggiungi(); }} />
        <select className="input !w-auto !py-1" value={tipo} onChange={e => setTipo(e.target.value)}><option value="colonna">Colonna</option><option value="sub">Sotto-sigla</option></select>
        <button className="btn-secondary !py-1" onClick={aggiungi}>Aggiungi sigla</button>
        {nota && <span className="text-xs text-gray-600">{nota}</span>}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm">
        <button className="font-medium text-blue-700 hover:underline" onClick={() => setElencoAperto(o => !o)}>{elencoAperto ? '▾' : '▸'} Carica un elenco di sigle con le descrizioni</button>
        {elencoAperto && (
          <div className="mt-2 space-y-2">
            <p className="text-xs text-gray-500">Una sigla per riga, con la descrizione dopo un tab, un «;» o uno spazio (es. <code>BIC2 CARROZZERIA BICOLORE</code>). Puoi incollarlo oppure scegliere un file (.txt, .csv, .xlsx: sigla nella prima colonna, descrizione nella seconda). Senza descrizione va bene: quando un Excel la ha, ti chiedo se aggiungerla.</p>
            <textarea className="input w-full font-mono text-xs" rows={6} value={testoElenco} onChange={e => setTestoElenco(e.target.value)} placeholder={'BIC2\tCARROZZERIA BICOLORE\nCEXS\tRIVEST.SOTTOPORTA IN CARBONIO\nTLM13'} />
            <div className="flex flex-wrap items-center gap-2">
              <input type="file" accept=".txt,.csv,.tsv,.xlsx,.xls" className="text-xs" onChange={e => leggiFile(e.target.files?.[0])} />
              <select className="input !w-auto !py-1" value={tipoElenco} onChange={e => setTipoElenco(e.target.value as 'colonna' | 'sub')}>
                <option value="colonna">Le sigle nuove vanno come Colonna</option><option value="sub">Le sigle nuove vanno come Sotto-sigla</option>
              </select>
              <button className="btn-primary !py-1" disabled={!testoElenco.trim()} onClick={caricaElenco}>Carica l&apos;elenco</button>
              <span className="text-xs text-gray-500">Valgono per tutti i modelli. Quelle già decise non si toccano (si aggiorna solo la descrizione).</span>
            </div>
          </div>
        )}
      </div>

      {proposteDesc.length > 0 && (
        <div className="rounded-xl border border-sky-300 bg-sky-50 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <b>{proposteDesc.length} {proposteDesc.length === 1 ? 'sigla senza descrizione' : 'sigle senza descrizione'}</b>: le schede la hanno. Vuoi aggiungerla? Comparirà nella colonna, per esempio «CARROZZERIA BICOLORE (BIC2)».
            <button className="btn-primary !py-0.5 text-xs" onClick={() => descrizioni('accetta', proposteDesc.map(x => x.codice))}>Aggiungi tutte</button>
          </div>
          <table className="mt-2 w-full"><tbody>
            {proposteDesc.map(x => (
              <tr key={x.codice} className="border-t border-sky-200">
                <td className="py-1 pr-3 font-bold">{x.codice}</td><td className="py-1 pr-3">{x.descrizione_proposta}</td>
                <td className="py-1 text-right whitespace-nowrap">
                  <button className="btn-primary !py-0.5 text-xs mr-1" onClick={() => descrizioni('accetta', [x.codice])}>Aggiungi</button>
                  <button className="btn-secondary !py-0.5 text-xs mr-1" onClick={() => scriviDescrizione(x)}>Scrivi la mia…</button>
                  <button className="btn-secondary !py-0.5 text-xs" onClick={() => descrizioni('rifiuta', [x.codice])}>No</button>
                </td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}

      {conta.da > 0 ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm">
          <b>{conta.da} {conta.da === 1 ? 'sigla' : 'sigle'} da decidere.</b> Per ognuna scegli <b>Sì</b> (compare come colonna nella tabella di «Vedere»), <b>Non mi serve</b> (è una sigla ma non ti interessa)
          oppure <b>Non è una sigla</b> (per esempio un colore o un codice di materiale). In tutti i casi non te lo chiederà più. A destra scegli a quali modelli vale.
          <div className="mt-2 flex flex-wrap gap-2">
            {filtro !== 'da' && <button className="btn-secondary !py-0.5 text-xs" onClick={() => setFiltro('da')}>Mostra solo quelle da decidere</button>}
            <button className="btn-primary !py-0.5 text-xs" onClick={() => inBlocco('colonna')}>Tutte Sì</button>
            <button className="btn-secondary !py-0.5 text-xs" onClick={() => inBlocco('no')}>Tutte Non mi serve</button>
          </div>
        </div>
      ) : conta.si > 0 ? (
        <div className="rounded-xl border border-green-300 bg-green-50 px-4 py-2 text-sm">Tutte le sigle sono decise: {conta.si} in tabella. <Link href="/ferrari" className="font-semibold text-blue-700 hover:underline">Vai a «Vedere»</Link> per guardare le schede.</div>
      ) : (
        <div className="rounded-xl border border-sky-300 bg-sky-50 px-4 py-2 text-sm">Tutte le sigle sono ignorate: la tabella resterà vuota. Metti «Sì» a quelle che vuoi vedere.</div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input className="input !w-64 !py-1" placeholder="Cerca sigla o descrizione…" value={cerca} onChange={e => setCerca(e.target.value)} />
        <select className="input !w-auto !py-1" value={filtro} onChange={e => { setFiltro(e.target.value as Filtro); setScelto(true); }}>
          <option value="tutte">Tutte ({tutte.length})</option><option value="da">Da decidere ({conta.da})</option><option value="si">Sì - in tabella ({conta.si})</option>
          <option value="no">Non mi servono ({conta.no})</option><option value="ns">Non sono sigle ({conta.ns})</option>
        </select>
        <span className="text-xs text-gray-500">{righe.length} {righe.length === 1 ? 'sigla' : 'sigle'}</span>
      </div>

      <div className="max-h-[68vh] overflow-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr>{['Sigla', 'Cosa è', 'Decisione', 'Sotto-sigla', 'Dentro quale voce', 'Modelli', ''].map((h, i) => (
              <th key={i} className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 text-left font-semibold whitespace-nowrap">{h}</th>))}</tr>
          </thead>
          <tbody>
            {righe.map(s => {
              const x = sintesi(s), st = x.stato, da = st === 'da_decidere', sc = modelliScelti(s);
              return (
                <tr key={s.codice} className={da ? 'bg-amber-50/60' : ''}>
                  <td className="border-b border-gray-100 px-3 py-1.5 font-bold">{s.codice}</td>
                  <td className="border-b border-gray-100 px-3 py-1.5 max-w-[26rem]" title={s.esempio}>
                    {x.auto && <span className="mr-1.5 rounded bg-gray-100 px-1.5 text-xs text-gray-600" title="Deciso dal programma perché gli altri modelli lo avevano deciso tutti allo stesso modo. Cambialo se è sbagliato: ne terrà conto.">automatica</span>}
                    {da && x.suggerimento && <span className="mr-1.5 rounded bg-gray-100 px-1.5 text-xs text-gray-600" title="Cosa hai deciso negli altri modelli">altri modelli: {x.suggerimento}</span>}
                    {st === 'sub' && <span className="mr-1.5 rounded bg-blue-100 px-1.5 text-xs text-blue-700">sotto-sigla</span>}
                    {st === 'alias' && <span className="mr-1.5 rounded bg-amber-100 px-1.5 text-xs text-amber-800">= errore di {x.alias ?? '?'}</span>}
                    {st === 'misto' && <span className="mr-1.5 rounded bg-gray-100 px-1.5 text-xs text-gray-600">scelte diverse per modello</span>}
                    {x.padre && <span className="mr-1.5 rounded bg-amber-100 px-1.5 text-xs text-amber-800">dentro {x.padre}</span>}
                    {x.simile_a && <span className="mr-1.5 text-xs font-semibold text-amber-700">simile a {x.simile_a}</span>}
                    {s.nome}{s.esempio && <span className="text-xs text-gray-400"> · {s.esempio.slice(0, 70)}</span>}
                    <button className="ml-1.5 text-xs text-gray-400 hover:text-blue-700" title="Scrivi o cambia la descrizione" onClick={() => scriviDescrizione(s)}>✎</button>
                  </td>
                  <td className="border-b border-gray-100 px-3 py-1.5 whitespace-nowrap">
                    {([['colonna', 'Sì', st === 'da_decidere' && x.sub ? 'sub' : 'colonna'], ['no', 'Non mi serve', 'no'], ['nonsigla', 'Non è una sigla', 'nonsigla']] as const).map(([id, label, valore]) => (
                      <button key={id} className={`!py-0.5 mr-1 text-xs ${st === id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => imposta(s, valore)}
                        title={id === 'colonna' ? 'È una sigla: compare come colonna in Vedere' : id === 'no' ? 'È una sigla ma non ti serve: non verrà più chiesta' : 'Non è una sigla (un colore, un codice di materiale...): non verrà più chiesta'}>{label}</button>
                    ))}
                    <button className={`!py-0.5 text-xs ${st === 'alias' ? 'btn-primary' : 'btn-secondary'}`} title="È un errore di scrittura di un'altra sigla"
                      onClick={() => { const a = (prompt(`Questo codice (${s.codice}) è un errore di scrittura di quale sigla? (scrivi il codice giusto, es. CEXS)`, x.alias ?? '') ?? '').trim(); if (a) imposta(s, 'alias', a); }}>È…</button>
                  </td>
                  <td className="border-b border-gray-100 px-3 py-1.5">
                    <button className={`!py-0.5 text-xs ${st === 'sub' ? 'btn-primary' : 'btn-secondary'}`}
                      title="Sotto-sigla: compare dentro la cella di un'altra voce, non come colonna" onClick={() => imposta(s, st === 'sub' ? 'colonna' : 'sub')}>{st === 'sub' ? 'Sì' : 'No'}</button>
                  </td>
                  <td className="border-b border-gray-100 px-3 py-1.5">
                    {st === 'sub' ? (
                      <select className="input !w-auto !py-0.5 text-xs" value={x.padre ?? ''} onChange={e => imposta(s, 'sub', null, e.target.value || null)}>
                        <option value="">In qualsiasi voce</option>
                        {padriPossibili(s, x.padre).map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="border-b border-gray-100 px-3 py-1.5">
                    <details className="relative">
                      <summary className="btn-secondary !py-0.5 text-xs cursor-pointer list-none whitespace-nowrap">
                        {!sc.length ? 'Scegli i modelli…' : sc.length === c.modelli.length ? `Tutti i modelli (${sc.length})` : sc.length <= 2 ? sc.join(', ') : `${sc.length} modelli`}
                      </summary>
                      <div className="absolute z-20 mt-1 min-w-[14rem] rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
                        <label className="block text-xs font-semibold">
                          <input type="checkbox" checked={sc.length === c.modelli.length} onChange={e => setScelti(z => ({ ...z, [s.codice]: e.target.checked ? c.modelli.map(m => m.modello) : [] }))} /> Seleziona tutti
                        </label>
                        {c.modelli.map(m => (
                          <label key={m.modello} className="block text-xs">
                            <input type="checkbox" checked={sc.includes(m.modello)} onChange={e => setScelti(z => ({ ...z, [s.codice]: e.target.checked ? [...sc, m.modello] : sc.filter(y => y !== m.modello) }))} /> {m.modello}{' '}
                            <span className="text-gray-400">{s.stati[m.modello] ? NOME_STATO[s.stati[m.modello]!.stato] : 'non compare'}</span>
                          </label>
                        ))}
                        <p className="mt-1 text-[11px] text-gray-500">Poi premi Sì, Non mi serve o Non è una sigla.</p>
                      </div>
                    </details>
                  </td>
                  <td className="border-b border-gray-100 px-3 py-1.5 text-right">
                    <button className="text-gray-400 hover:text-red-600" title="Togli questa sigla da tutti i modelli (tornerà da decidere)"
                      onClick={async () => { if (confirm(`Togliere ${s.codice} da tutti i modelli? Tornerà da decidere se compare ancora nelle schede.`)) { try { await api.post('/api/ferrari/sigle/imposta', { codice: s.codice, stato: 'reset', modelli: '*' }); } catch (e) { setErrore((e as Error).message); } await carica(); } }}>✕</button>
                  </td>
                </tr>
              );
            })}
            {righe.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400">{tutte.length ? 'Nessuna sigla corrisponde al filtro o alla ricerca.' : 'Non ci sono sigle.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

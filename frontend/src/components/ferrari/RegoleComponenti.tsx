'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import {
  chiaveRegola, descriviAzione, descriviCondizione, ESITO, perApi, regoleApi, scaricaModelloRegole,
  type Azione, type Condizione, type ProvaRegole, type RegolaComp, type RisultatoImport, type VoceComp,
} from '@/lib/ferrari-regole';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { scaricaFile } from '@/lib/ferrari';
import { Errore } from '@/components/ferrari/Comuni';

// Pagina delle regole: una riga per regola (una frase), un clic per modificarla. Solo quello che serve.

type Bozza = RegolaComp & { k: number; aperta: boolean };
let contatore = 0;
const nuova = (): Bozza => ({
  k: ++contatore, aperta: true, nome: '', attiva: true, modello: '*', logica: 'tutte', ferma: false,
  condizioni: [{ tipo: 'presente', sigla: '' }], eccezioni: [], azioni: [{ componente: '', valore: { tipo: 'sigla', sigla: '' } }],
});
const maiuscolo = (s: string) => s.toUpperCase();

/** La regola come frase: serve sia da riga della lista sia da nome salvato. */
function frase(r: RegolaComp): string {
  const cond = r.condizioni.length === 0 ? 'sempre' : r.condizioni.map(descriviCondizione).join(r.logica === 'tutte' ? ' e ' : ' oppure ');
  const ecc = r.eccezioni.length > 0 ? `, salvo se ${r.eccezioni.map(descriviCondizione).join(' o ')}` : '';
  return `Se ${cond}${ecc} → ${r.azioni.map(descriviAzione).join(' · ')}`;
}
const pulita = (b: Bozza): RegolaComp => ({ ...perApi(b), nome: frase(b).slice(0, 80) });      // il nome e' la frase: niente da inventare
const impronta = (b: Bozza[]) => JSON.stringify(b.map(pulita));

/** Una condizione come etichetta corta: «AS06», «senza EXAB», «MRKT = CINA». */
function EtichettaCond({ c }: { c: Condizione }) {
  const base = 'inline-block rounded-ctl px-1.5 py-0.5 text-xs';
  switch (c.tipo) {
    case 'presente': return <span className={`${base} bg-stone-100 font-mono font-semibold text-ink-800`}>{c.sigla || '…'}</span>;
    case 'assente': return <span className={`${base} bg-danger-soft font-mono font-semibold text-danger`}>senza {c.sigla || '…'}</span>;
    case 'valore': return <span className={`${base} bg-stone-100 text-ink-800`}><span className="font-mono font-semibold">{c.sigla || '…'}</span> = {c.testo}</span>;
    case 'testo': return <span className={`${base} bg-stone-100 text-ink-800`}>{c.sigla?.trim() ? <><span className="font-mono font-semibold">{c.sigla}</span> contiene</> : 'testo contiene'} «{c.testo}»</span>;
  }
}

function SeLeggi({ r }: { r: RegolaComp }) {
  if (r.condizioni.length === 0) return <span className="text-sm text-muted">sempre</span>;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {r.condizioni.map((c, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 && <span className="text-xs text-muted">{r.logica === 'tutte' ? 'e' : 'oppure'}</span>}
          <EtichettaCond c={c} />
        </span>
      ))}
      {r.eccezioni.length > 0 && (
        <span className="inline-flex flex-wrap items-center gap-1">
          <span className="text-xs text-muted">tranne se</span>
          {r.eccezioni.map((c, i) => <EtichettaCond key={i} c={c} />)}
        </span>
      )}
    </div>
  );
}

function Allora({ r }: { r: RegolaComp }) {
  return (
    <ul className="space-y-0.5 text-sm">
      {r.azioni.map((a, i) => (
        <li key={i}>
          <span className="font-semibold text-ink-900">{a.componente || '…'}</span>
          <span className="ml-2 font-mono text-xs text-ink-700">
            {a.valore.tipo === 'sigla' ? a.valore.sigla || '…' : a.valore.tipo === 'fisso' ? `«${a.valore.testo}»` : `testo di ${a.valore.sigla || '…'}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

const TIPI_COND: { v: Condizione['tipo']; t: string }[] = [
  { v: 'presente', t: 'ha' }, { v: 'assente', t: 'NON ha' }, { v: 'valore', t: 'valore di' }, { v: 'testo', t: 'testo contiene' },
];
const TIPI_VALORE: { v: Azione['valore']['tipo']; t: string }[] = [
  { v: 'sigla', t: 'la sigla' }, { v: 'fisso', t: 'un testo' }, { v: 'testo', t: 'il testo della sigla' },
];

function CondizioneRiga({ c, onChange, onTogli }: { c: Condizione; onChange: (c: Condizione) => void; onTogli: () => void }) {
  const cambiaTipo = (tipo: Condizione['tipo']) => {
    const sigla = c.sigla ?? '';
    if (tipo === 'presente' || tipo === 'assente') onChange({ tipo, sigla });
    else onChange({ tipo, sigla, testo: 'testo' in c ? c.testo : '' });
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className="input !w-auto !py-1" value={c.tipo} aria-label="Tipo di condizione" onChange={e => cambiaTipo(e.target.value as Condizione['tipo'])}>
        {TIPI_COND.map(t => <option key={t.v} value={t.v}>{t.t}</option>)}
      </select>
      <input className="input !w-28 !py-1 font-mono" placeholder={c.tipo === 'testo' ? 'tutta la scheda' : 'Sigla'} aria-label="Sigla" list="sigle-regole"
        value={c.sigla ?? ''} onChange={e => onChange({ ...c, sigla: maiuscolo(e.target.value) } as Condizione)} />
      {(c.tipo === 'valore' || c.tipo === 'testo') && (
        <input className="input !w-48 !py-1" placeholder={c.tipo === 'valore' ? '= uguale a…' : 'la parola…'} aria-label="Testo"
          value={c.testo} onChange={e => onChange({ ...c, testo: e.target.value } as Condizione)} />
      )}
      <button type="button" className="px-1 text-muted hover:text-danger" onClick={onTogli} aria-label="Togli">×</button>
    </div>
  );
}

function AzioneRiga({ a, onChange, onTogli }: { a: Azione; onChange: (a: Azione) => void; onTogli: () => void }) {
  const v = a.valore;
  const cambiaTipo = (tipo: Azione['valore']['tipo']) =>
    onChange({ ...a, valore: tipo === 'fisso' ? { tipo, testo: v.tipo === 'fisso' ? v.testo : '' } : { tipo, sigla: v.tipo !== 'fisso' ? v.sigla : '' } });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted">aggiungi a</span>
      <input className="input !w-40 !py-1" placeholder="Componente" aria-label="Componente" list="componenti-regole" value={a.componente}
        onChange={e => onChange({ ...a, componente: e.target.value })} />
      <select className="input !w-auto !py-1" value={v.tipo} aria-label="Cosa aggiungere" onChange={e => cambiaTipo(e.target.value as Azione['valore']['tipo'])}>
        {TIPI_VALORE.map(t => <option key={t.v} value={t.v}>{t.t}</option>)}
      </select>
      {v.tipo === 'fisso'
        ? <input className="input !w-40 !py-1" placeholder="Testo" aria-label="Testo" value={v.testo} onChange={e => onChange({ ...a, valore: { tipo: 'fisso', testo: e.target.value } })} />
        : <input className="input !w-28 !py-1 font-mono" placeholder="Sigla" aria-label="Sigla" list="sigle-regole" value={v.sigla}
            onChange={e => onChange({ ...a, valore: { tipo: v.tipo, sigla: maiuscolo(e.target.value) } })} />}
      <button type="button" className="px-1 text-muted hover:text-danger" onClick={onTogli} aria-label="Togli">×</button>
    </div>
  );
}

export function RegoleComponenti({ puoModificare }: { puoModificare: boolean }) {
  const [bozza, setBozza] = useState<Bozza[] | null>(null);
  const [salvate, setSalvate] = useState('');
  const [modelli, setModelli] = useState<string[]>([]);
  const [componenti, setComponenti] = useState<string[]>([]);
  const [errore, setErrore] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [occupato, setOccupato] = useState(false);
  const [importando, setImportando] = useState(false);
  const [commessa, setCommessa] = useState('');
  const [prova, setProva] = useState<ProvaRegole | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const sostituisciRef = useRef(false);                  // il prossimo file sostituisce le regole che stanno nel formato Excel
  const [importo, setImporto] = useState<{ nome: string; aggiunte: number; doppie: number; errori: RisultatoImport['errori']; troppe: number; sostituite?: number; restano?: number } | null>(null);
  const [fTesto, setFTesto] = useState('');                 // cerca una sigla, un testo o un componente
  const [fModello, setFModello] = useState('');             // '' = tutti, '*' = solo le generali, altrimenti un modello

  const imposta = useCallback((rs: RegolaComp[]) => {
    const b = rs.map(r => ({ ...r, k: ++contatore, aperta: false }));
    setBozza(b); setSalvate(impronta(b));
  }, []);

  useEffect(() => {
    regoleApi.elenco().then(r => imposta(r.regole)).catch(e => setErrore((e as Error).message));
    api.get<{ modelli: { modello: string }[]; componenti: { nome: string }[] }>('/api/ferrari/componenti')
      .then(r => { setModelli(r.modelli.map(m => m.modello)); setComponenti(r.componenti.map(c => c.nome)); }).catch(() => {});
  }, [imposta]);

  const sporca = bozza !== null && impronta(bozza) !== salvate;
  const nomiComp = useMemo(() => [...new Set([...componenti, ...(bozza ?? []).flatMap(r => r.azioni.map(a => a.componente.trim()).filter(Boolean))])], [componenti, bozza]);

  const filtrando = fTesto.trim() !== '' || fModello !== '';
  const visibili = useMemo(() => {
    const t = fTesto.trim().toLowerCase();
    const contiene = (r: RegolaComp) => {
      const pezzi: string[] = [];
      for (const c of [...r.condizioni, ...r.eccezioni]) pezzi.push(c.sigla ?? '', 'testo' in c ? c.testo : '');
      for (const a of r.azioni) pezzi.push(a.componente, a.valore.tipo === 'fisso' ? a.valore.testo : a.valore.sigla);
      return pezzi.some(x => x.toLowerCase().includes(t));
    };
    return (bozza ?? []).map((r, i) => ({ r, i })).filter(({ r }) =>
      (!t || contiene(r)) && (!fModello || (fModello === '*' ? r.modello === '*' : r.modello === '*' || r.modello === fModello)));
  }, [bozza, fTesto, fModello]);

  const modifica = useCallback((k: number, f: (r: Bozza) => Bozza) => { setBozza(b => b && b.map(r => (r.k === k ? f(r) : r))); setProva(null); setMsg(''); }, []);
  const sposta = (i: number, d: -1 | 1) => setBozza(b => {
    if (!b || i + d < 0 || i + d >= b.length) return b;
    const c = [...b]; [c[i], c[i + d]] = [c[i + d]!, c[i]!]; setProva(null); return c;
  });

  function controlla(): string | null {
    for (const [i, r] of (bozza ?? []).entries()) {
      const n = `Regola ${i + 1}`;
      if ([...r.condizioni, ...r.eccezioni].some(c => (c.tipo !== 'testo' && !c.sigla?.trim()) || ((c.tipo === 'valore' || c.tipo === 'testo') && !c.testo.trim()))) return `${n}: una condizione è incompleta`;
      if (r.azioni.length === 0) return `${n}: aggiungi almeno un'azione`;
      if (r.azioni.some(a => !a.componente.trim() || (a.valore.tipo === 'fisso' ? !a.valore.testo.trim() : !a.valore.sigla.trim()))) return `${n}: un'azione è incompleta`;
    }
    return null;
  }

  async function salva() {
    const p = controlla();
    if (p) { setErrore(p); return; }
    setOccupato(true); setErrore(null);
    try {
      const r = await regoleApi.salva((bozza ?? []).map(pulita));
      imposta(r.regole); setProva(null);
      setMsg('Salvate');
    } catch (e) { setErrore((e as Error).message); } finally { setOccupato(false); }
  }

  async function provaOra() {
    if (!commessa.trim() || !bozza) return;
    const p = controlla();
    if (p) { setErrore(p); return; }
    setErrore(null);
    try { setProva(await regoleApi.prova(commessa.trim(), bozza.map(pulita))); } catch (e) { setProva(null); setErrore((e as Error).message); }
  }

  /** Legge l'Excel e mette le regole nella bozza (la persona le controlla e preme Salva). Aggiunge in fondo, oppure sostituisce
   *  quelle che stanno nel formato Excel (le complesse — eccezioni, «oppure»… — restano, in fondo). */
  async function importa(file: File | undefined) {
    const sostituisci = sostituisciRef.current;
    sostituisciRef.current = false;
    if (!file || !bozza) return;
    setErrore(null); setImportando(true);
    try {
      const r = await regoleApi.importa(file);
      setFTesto(''); setFModello(''); setProva(null);
      if (sostituisci) {
        if (r.regole.length === 0) throw new Error('Nel file non c\'è nessuna regola valida: non sostituisco niente');
        const { indici } = await regoleApi.esportabili(bozza.map(pulita));
        const via = new Set(indici);
        const restano = bozza.filter((_, i) => !via.has(i));
        const nuove = r.regole.slice(0, Math.max(0, 500 - restano.length));
        setBozza([...nuove.map(x => ({ ...x, k: ++contatore, aperta: false })), ...restano]);
        setImporto({ nome: file.name, aggiunte: nuove.length, doppie: 0, errori: r.errori, troppe: r.regole.length - nuove.length, sostituite: via.size, restano: restano.length });
        return;
      }
      const esistenti = new Set(bozza.map(b => chiaveRegola(b)));
      const nuove: RegolaComp[] = [];
      let doppie = 0;
      for (const x of r.regole) {
        const k = chiaveRegola(x);
        if (esistenti.has(k)) { doppie++; continue; }
        esistenti.add(k); nuove.push(x);
      }
      const posto = Math.max(0, 500 - bozza.length);                              // stesso limite del server
      const aggiunte = nuove.slice(0, posto);
      setBozza(b => [...(b ?? []), ...aggiunte.map(x => ({ ...x, k: ++contatore, aperta: false }))]);
      setImporto({ nome: file.name, aggiunte: aggiunte.length, doppie, errori: r.errori, troppe: nuove.length - aggiunte.length });
    } catch (e) { setImporto(null); setErrore((e as Error).message); } finally { setImportando(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  const azioniPagina = puoModificare && (
    <>
      {sporca && <button className="btn-secondary" onClick={() => { imposta(JSON.parse(salvate) as RegolaComp[]); setProva(null); }}>Annulla</button>}
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { void importa(e.target.files?.[0]); }} />
      <ActionMenu label={importando ? 'Lettura…' : 'Excel'} items={[
        { label: 'Importa da Excel…', onClick: () => { sostituisciRef.current = false; fileRef.current?.click(); }, disabled: importando || bozza === null, title: 'Aggiunge le regole di un foglio Excel in fondo alla lista (una riga = una regola)' },
        { label: 'Sostituisci con Excel…', disabled: importando || !bozza || bozza.length === 0,
          title: 'Toglie le regole che stanno nel formato Excel e mette quelle del file. Le regole complesse (eccezioni, «oppure»…) restano. Non salva: si può annullare.',
          onClick: () => {
            if (!confirm('Le regole che stanno nel formato Excel verranno sostituite da quelle del file.\nLe regole complesse (con eccezioni, «oppure», «il testo contiene») restano in fondo alla lista.\nNon si salva finché non premi Salva: puoi annullare.\n\nContinuare?')) return;
            sostituisciRef.current = true; fileRef.current?.click();
          } },
        { label: 'Scarica le regole', onClick: () => { scaricaFile('/api/ferrari/regole-componenti/esporta', { nome: 'regole-componenti.xlsx' }).catch(e => setErrore((e as Error).message)); },
          disabled: sporca || !bozza || bozza.length === 0, title: sporca ? 'Salva le modifiche prima di scaricarle' : 'Le regole salvate, nello stesso formato dell\'importazione', separatore: true },
        { label: 'Scarica il modello', onClick: () => { void scaricaModelloRegole(); }, title: 'Foglio di esempio con le istruzioni' },
      ]} />
      <button className="btn-secondary" onClick={() => { setFTesto(''); setFModello(''); setBozza(b => [...(b ?? []), nuova()]); setProva(null); }}>Nuova regola</button>
      <button className="btn-primary" disabled={!sporca || occupato} onClick={salva}>{occupato ? 'Salvataggio…' : 'Salva'}</button>
    </>
  );

  return (
    <div>
      <PageHeader back={{ label: 'Per componente', href: '/ferrari/componenti' }} title="Regole dei componenti"
        description={msg && !sporca ? msg : 'Si applicano dall\'alto in basso.'} actions={azioniPagina} />
      <datalist id="componenti-regole">{nomiComp.map(n => <option key={n} value={n} />)}</datalist>
      <datalist id="sigle-regole">{(prova?.sigle ?? []).map(s => <option key={s} value={s} />)}</datalist>
      <Errore messaggio={errore} />

      {bozza === null ? <p className="py-10 text-center text-sm text-muted">Caricamento…</p> : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0">
          {importo && (
            <div className="d-print-none mb-3 rounded-card border border-line bg-white px-4 py-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <p>
                  <b>{importo.nome}</b>: {importo.sostituite !== undefined
                    ? <><b>{importo.sostituite}</b> {importo.sostituite === 1 ? 'regola sostituita' : 'regole sostituite'} da <b>{importo.aggiunte}</b> del file{importo.restano ? <> · <b>{importo.restano}</b> {importo.restano === 1 ? 'regola complessa resta' : 'regole complesse restano'} in fondo</> : null}</>
                    : importo.aggiunte === 0 ? 'nessuna regola nuova' : <><b>{importo.aggiunte}</b> {importo.aggiunte === 1 ? 'regola aggiunta' : 'regole aggiunte'} in fondo alla lista</>}
                  {importo.doppie > 0 && <span className="text-muted"> · {importo.doppie} già presenti, saltate</span>}
                  {importo.troppe > 0 && <span className="text-warning"> · {importo.troppe} non aggiunte: massimo 500 regole</span>}
                  {(importo.aggiunte > 0 || importo.sostituite !== undefined) && <span className="text-muted"> · controllale e premi <b>Salva</b> (o <b>Annulla</b>)</span>}
                </p>
                <button className="shrink-0 text-xs text-muted hover:text-ink-900" onClick={() => setImporto(null)}>Chiudi</button>
              </div>
              {importo.errori.length > 0 && (
                <details className="mt-2" open={importo.errori.length <= 5}>
                  <summary className="cursor-pointer text-warning">{importo.errori.length} {importo.errori.length === 1 ? 'riga non letta' : 'righe non lette'}</summary>
                  <ul className="mt-1 space-y-0.5 text-xs text-ink-700">
                    {importo.errori.slice(0, 50).map(e => <li key={e.riga}>Riga {e.riga}: {e.motivo}</li>)}
                    {importo.errori.length > 50 && <li className="text-muted">… e altre {importo.errori.length - 50}</li>}
                  </ul>
                </details>
              )}
            </div>
          )}
          {bozza.length > 1 && (
            <div className="d-print-none mb-3 flex flex-wrap items-center gap-2">
              <input className="input !w-60 !py-1.5" placeholder="Cerca sigla, testo o componente…" value={fTesto} onChange={ev => setFTesto(ev.target.value)} aria-label="Cerca nelle regole" />
              <select className="input !w-auto !py-1.5" value={fModello} onChange={ev => setFModello(ev.target.value)} aria-label="Filtra per modello">
                <option value="">Tutti i modelli</option>
                <option value="*">Solo le generali</option>
                {[...new Set([...modelli, ...bozza.map(r => r.modello).filter(m => m !== '*')])].map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              {filtrando && (
                <>
                  <span className="text-xs text-muted">{visibili.length} di {bozza.length}</span>
                  <button className="text-xs font-semibold text-accent-ink hover:underline" onClick={() => { setFTesto(''); setFModello(''); }}>Azzera</button>
                </>
              )}
            </div>
          )}
          {bozza.length === 0 ? (
            <div className="rounded-card border border-line bg-white">
              <EmptyState title="Nessuna regola" hint="Esempio: se la scheda ha AS06, aggiungi AS06 a Paraurti."
                action={puoModificare ? <button className="btn-primary" onClick={() => setBozza([nuova()])}>Nuova regola</button> : undefined} />
            </div>
          ) : (
            <div className="overflow-hidden rounded-card border border-line bg-white">
            <div className="hidden grid-cols-[1.25rem_minmax(0,1fr)_1.25rem_minmax(0,1fr)_15rem] gap-x-3 border-b border-line bg-stone-50 px-4 py-2 text-xs font-medium text-muted md:grid">
              <span /><span>Se la scheda…</span><span /><span>Allora aggiungi a…</span><span />
            </div>
            <ol className="divide-y divide-line">
              {visibili.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">Nessuna regola corrisponde ai filtri.</li>}
              {visibili.map(({ r, i }) => {
                const e = prova?.regole[i];
                return (
                  <li key={r.k} className={r.attiva ? '' : 'bg-stone-50'}>
                    <div className="flex items-center gap-3 px-4 py-3">
                      <span className="w-5 shrink-0 text-center text-xs tabular-nums text-muted">{i + 1}</span>
                      <button className="grid min-w-0 flex-1 items-center gap-x-3 gap-y-1 text-left md:grid-cols-[minmax(0,1fr)_1.25rem_minmax(0,1fr)]"
                        onClick={() => setBozza(b => b && b.map(x => (x.k === r.k ? { ...x, aperta: !x.aperta } : x)))} aria-expanded={r.aperta}>
                        <span className={r.attiva ? '' : 'opacity-50'}><SeLeggi r={r} /></span>
                        <span className="hidden text-muted md:block" aria-hidden>→</span>
                        <span className={r.attiva ? '' : 'opacity-50'}>
                          <Allora r={r} />
                          {(r.modello !== '*' || r.ferma || !r.attiva) && (
                            <span className="mt-0.5 block text-xs text-muted">
                              {[!r.attiva && 'disattivata', r.modello !== '*' && `solo ${r.modello}`, r.ferma && 'poi si ferma'].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </span>
                      </button>
                      <span className="flex shrink-0 items-center justify-end gap-2 md:w-60">
                      {e && <span className={`w-20 shrink-0 text-right text-xs font-medium ${e.esito === 'scattata' ? 'text-success' : 'text-muted'}`}>{ESITO[e.esito].testo}</span>}
                      {puoModificare && (
                        <span className="flex shrink-0 items-center gap-1 text-muted">
                          <button className="px-1.5 hover:text-ink-900 disabled:opacity-30" disabled={i === 0 || filtrando} title={filtrando ? 'Togli i filtri per cambiare l\'ordine' : undefined} onClick={() => sposta(i, -1)} aria-label="Sposta su">↑</button>
                          <button className="px-1.5 hover:text-ink-900 disabled:opacity-30" disabled={i === bozza.length - 1 || filtrando} title={filtrando ? 'Togli i filtri per cambiare l\'ordine' : undefined} onClick={() => sposta(i, 1)} aria-label="Sposta giù">↓</button>
                          <label className="ml-1 flex cursor-pointer items-center gap-1 text-xs"><input type="checkbox" checked={r.attiva} aria-label="Attiva"
                            onChange={ev => modifica(r.k, x => ({ ...x, attiva: ev.target.checked }))} />attiva</label>
                        </span>
                      )}
                      </span>
                    </div>

                    {r.aperta && (
                      <div className="space-y-3 border-t border-line bg-stone-50 px-4 py-4 pl-12">
                        <fieldset disabled={!puoModificare} className="space-y-3">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-700">Se la scheda
                              {r.condizioni.length > 1 && (
                                <select className="input !w-auto !py-1 font-normal" value={r.logica} aria-label="Quante condizioni"
                                  onChange={ev => modifica(r.k, x => ({ ...x, logica: ev.target.value as 'tutte' | 'qualsiasi' }))}>
                                  <option value="tutte">soddisfa tutte queste condizioni</option><option value="qualsiasi">soddisfa almeno una</option>
                                </select>
                              )}
                            </div>
                            {r.condizioni.map((c, ci) => (
                              <CondizioneRiga key={ci} c={c} onChange={n => modifica(r.k, x => ({ ...x, condizioni: x.condizioni.map((y, j) => (j === ci ? n : y)) }))}
                                onTogli={() => modifica(r.k, x => ({ ...x, condizioni: x.condizioni.filter((_, j) => j !== ci) }))} />
                            ))}
                            <button type="button" className="text-xs font-semibold text-accent-ink hover:underline" onClick={() => modifica(r.k, x => ({ ...x, condizioni: [...x.condizioni, { tipo: 'presente', sigla: '' }] }))}>+ condizione</button>
                          </div>

                          {r.eccezioni.length > 0 && (
                            <div className="space-y-2">
                              <div className="text-sm font-semibold text-ink-700">Salvo se</div>
                              {r.eccezioni.map((c, ci) => (
                                <CondizioneRiga key={ci} c={c} onChange={n => modifica(r.k, x => ({ ...x, eccezioni: x.eccezioni.map((y, j) => (j === ci ? n : y)) }))}
                                  onTogli={() => modifica(r.k, x => ({ ...x, eccezioni: x.eccezioni.filter((_, j) => j !== ci) }))} />
                              ))}
                            </div>
                          )}

                          <div className="space-y-2">
                            <div className="text-sm font-semibold text-ink-700">Allora</div>
                            {r.azioni.map((a, ai) => (
                              <AzioneRiga key={ai} a={a} onChange={n => modifica(r.k, x => ({ ...x, azioni: x.azioni.map((y, j) => (j === ai ? n : y)) }))}
                                onTogli={() => modifica(r.k, x => ({ ...x, azioni: x.azioni.filter((_, j) => j !== ai) }))} />
                            ))}
                            <button type="button" className="text-xs font-semibold text-accent-ink hover:underline" onClick={() => modifica(r.k, x => ({ ...x, azioni: [...x.azioni, { componente: '', valore: { tipo: 'sigla', sigla: '' } }] }))}>+ azione</button>
                          </div>

                          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-3 text-xs text-muted">
                            {r.eccezioni.length === 0 && (
                              <button type="button" className="font-semibold text-accent-ink hover:underline" onClick={() => modifica(r.k, x => ({ ...x, eccezioni: [{ tipo: 'presente', sigla: '' }] }))}>+ eccezione</button>
                            )}
                            <label className="flex items-center gap-1.5">Vale per
                              <select className="input !w-auto !py-0.5 text-xs" value={r.modello} onChange={ev => modifica(r.k, x => ({ ...x, modello: ev.target.value }))}>
                                <option value="*">tutti i modelli</option>
                                {[...new Set([...modelli, ...(r.modello !== '*' ? [r.modello] : [])])].map(m => <option key={m} value={m}>{m}</option>)}
                              </select>
                            </label>
                            <label className="flex items-center gap-1.5" title="Se questa regola scatta, le regole sotto non si applicano: serve per le regole specifiche, da mettere sopra a quella generale.">
                              <input type="checkbox" checked={r.ferma} onChange={ev => modifica(r.k, x => ({ ...x, ferma: ev.target.checked }))} />ferma le regole seguenti
                            </label>
                            {puoModificare && (
                              <button type="button" className="ml-auto hover:text-danger" onClick={() => { setBozza(b => b && b.filter(x => x.k !== r.k)); setProva(null); }}>Elimina la regola</button>
                            )}
                          </div>
                        </fieldset>
                        {e && (
                          <ul className="border-t border-line pt-2 text-xs text-ink-700">
                            {e.condizioni.map((c, j) => <li key={`c${j}`}><span className={c.vera ? 'text-success' : 'text-danger'}>{c.vera ? '✓' : '✗'}</span> {c.testo}</li>)}
                            {e.eccezioni.map((c, j) => <li key={`e${j}`}><span className={c.vera ? 'text-warning' : 'text-muted'}>{c.vera ? '⚠' : '–'}</span> salvo se {c.testo}</li>)}
                          </ul>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
            </div>
          )}
          </div>

          <aside className="d-print-none order-first h-fit lg:sticky lg:top-4 lg:order-none">
            <form className="flex gap-2" onSubmit={ev => { ev.preventDefault(); void provaOra(); }}>
              <input className="input !py-1.5" placeholder="Prova con una commessa…" value={commessa} onChange={ev => setCommessa(ev.target.value)} aria-label="Commessa da provare" />
              <button className="btn-secondary" type="submit" disabled={!commessa.trim() || bozza.length === 0}>Prova</button>
            </form>
            {prova && (
              <div className="mt-3 rounded-card border border-line bg-white p-4 text-sm">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <b>Commessa {prova.commessa}</b>
                  <button className="text-xs text-muted hover:text-ink-900" onClick={() => setProva(null)}>Chiudi</button>
                </div>
                {Object.keys(prova.celle).length === 0 ? <p className="text-muted">Nessuna regola ha aggiunto niente.</p> : (
                  <dl className="space-y-1.5">
                    {Object.entries(prova.celle).map(([comp, voci]) => (
                      <div key={comp}><dt className="font-semibold">{comp}</dt><dd><ValoriComp voci={voci} /></dd></div>
                    ))}
                  </dl>
                )}
                <details className="mt-3 text-xs text-muted">
                  <summary className="cursor-pointer">Sigle trovate nella scheda ({prova.sigle.length})</summary>
                  <p className="mt-1 flex flex-wrap gap-1">{prova.sigle.map(x => <span key={x} className="rounded-ctl bg-stone-100 px-1.5 py-0.5 font-mono text-ink-700">{x}</span>)}</p>
                </details>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

export function ValoriComp({ voci }: { voci: VoceComp[] }) {
  return (
    <ul className="space-y-0.5">
      {voci.map(v => (
        <li key={v.testo} title={`Prodotto da: ${v.regole.map(r => r.nome).join(' | ')}`}>
          <span className="font-semibold">{v.testo}</span>
          {v.descrizione && <span className="ml-1.5 text-xs text-muted">{v.descrizione}</span>}
        </li>
      ))}
    </ul>
  );
}

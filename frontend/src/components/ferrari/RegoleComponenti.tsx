'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import {
  descriviAzione, descriviCondizione, ESITO, perApi, regoleApi,
  type Azione, type Condizione, type ProvaRegole, type RegolaComp, type VoceComp,
} from '@/lib/ferrari-regole';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Errore } from '@/components/ferrari/Comuni';

type Bozza = RegolaComp & { k: number; aperta: boolean };
let contatore = 0;
const nuova = (): Bozza => ({
  k: ++contatore, aperta: true, nome: 'Nuova regola', attiva: true, modello: '*', logica: 'tutte', ferma: false,
  condizioni: [{ tipo: 'presente', sigla: '' }], eccezioni: [], azioni: [{ componente: '', valore: { tipo: 'sigla', sigla: '' } }],
});
const pulita = (b: Bozza): RegolaComp => perApi(b);
const maiuscolo = (s: string) => s.toUpperCase();
const impronta = (b: Bozza[]) => JSON.stringify(b.map(pulita));

const TIPI_COND: { v: Condizione['tipo']; t: string }[] = [
  { v: 'presente', t: 'La scheda ha' }, { v: 'assente', t: 'La scheda NON ha' }, { v: 'valore', t: 'Il valore di … è' }, { v: 'testo', t: 'Il testo contiene' },
];
const TIPI_VALORE: { v: Azione['valore']['tipo']; t: string }[] = [
  { v: 'sigla', t: 'la sigla' }, { v: 'fisso', t: 'un testo fisso' }, { v: 'testo', t: 'il testo scritto per la sigla' },
];

function CondizioneRiga({ c, onChange, onTogli }: { c: Condizione; onChange: (c: Condizione) => void; onTogli: () => void }) {
  const cambiaTipo = (tipo: Condizione['tipo']) => {
    if (tipo === 'presente' || tipo === 'assente') onChange({ tipo, sigla: 'sigla' in c ? (c.sigla ?? '') : '' });
    else if (tipo === 'valore') onChange({ tipo, sigla: 'sigla' in c ? (c.sigla ?? '') : '', testo: 'testo' in c ? c.testo : '' });
    else onChange({ tipo, sigla: 'sigla' in c ? c.sigla : '', testo: 'testo' in c ? c.testo : '' });
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className="input !w-auto !py-1" value={c.tipo} aria-label="Tipo di condizione" onChange={e => cambiaTipo(e.target.value as Condizione['tipo'])}>
        {TIPI_COND.map(t => <option key={t.v} value={t.v}>{t.t}</option>)}
      </select>
      <input className="input !w-32 !py-1 font-mono" placeholder={c.tipo === 'testo' ? '(tutta la scheda)' : 'Sigla'} aria-label="Sigla" list="sigle-regole"
        value={c.sigla ?? ''} onChange={e => onChange({ ...c, sigla: maiuscolo(e.target.value) } as Condizione)} />
      {(c.tipo === 'valore' || c.tipo === 'testo') && (
        <input className="input !w-56 !py-1" placeholder={c.tipo === 'valore' ? 'è uguale a…' : 'contiene la parola…'} aria-label="Testo"
          value={c.testo} onChange={e => onChange({ ...c, testo: e.target.value } as Condizione)} />
      )}
      <button type="button" className="btn-secondary !px-2 !py-1" onClick={onTogli} aria-label="Togli la condizione">×</button>
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
      <input className="input !w-44 !py-1" placeholder="Componente" aria-label="Componente" list="componenti-regole" value={a.componente}
        onChange={e => onChange({ ...a, componente: e.target.value })} />
      <select className="input !w-auto !py-1" value={v.tipo} aria-label="Cosa aggiungere" onChange={e => cambiaTipo(e.target.value as Azione['valore']['tipo'])}>
        {TIPI_VALORE.map(t => <option key={t.v} value={t.v}>{t.t}</option>)}
      </select>
      {v.tipo === 'fisso'
        ? <input className="input !w-44 !py-1" placeholder="Testo" aria-label="Testo fisso" value={v.testo} onChange={e => onChange({ ...a, valore: { tipo: 'fisso', testo: e.target.value } })} />
        : <input className="input !w-32 !py-1 font-mono" placeholder="Sigla" aria-label="Sigla" list="sigle-regole" value={v.sigla}
            onChange={e => onChange({ ...a, valore: { tipo: v.tipo, sigla: maiuscolo(e.target.value) } })} />}
      <button type="button" className="btn-secondary !px-2 !py-1" onClick={onTogli} aria-label="Togli l'azione">×</button>
    </div>
  );
}

function Frase({ r }: { r: Bozza }) {
  const cond = r.condizioni.length === 0 ? 'sempre'
    : r.condizioni.map(descriviCondizione).join(r.logica === 'tutte' ? ' e ' : ' oppure ');
  return (
    <p className="text-sm text-ink-700">
      <b>Se</b> {cond}
      {r.eccezioni.length > 0 && <>, <b>salvo se</b> {r.eccezioni.map(descriviCondizione).join(' o ')}</>}
      {' → '}{r.azioni.map(descriviAzione).join(' · ')}
    </p>
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
  const [commessa, setCommessa] = useState('');
  const [prova, setProva] = useState<ProvaRegole | null>(null);

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

  const modifica = useCallback((k: number, f: (r: Bozza) => Bozza) => { setBozza(b => b && b.map(r => (r.k === k ? f(r) : r))); setProva(null); setMsg(''); }, []);
  const sposta = (i: number, d: -1 | 1) => setBozza(b => {
    if (!b || i + d < 0 || i + d >= b.length) return b;
    const c = [...b]; [c[i], c[i + d]] = [c[i + d]!, c[i]!]; setProva(null); return c;
  });

  function controlla(): string | null {
    for (const [i, r] of (bozza ?? []).entries()) {
      const n = `Regola ${i + 1} («${r.nome}»)`;
      if (!r.nome.trim()) return `Regola ${i + 1}: manca il nome`;
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
      setMsg(`Salvate ${r.regole.length} regole: la tabella si aggiorna da sola`);
    } catch (e) { setErrore((e as Error).message); } finally { setOccupato(false); }
  }

  async function provaOra() {
    if (!commessa.trim() || !bozza) return;
    const p = controlla();
    if (p) { setErrore(p); return; }
    setErrore(null);
    try { setProva(await regoleApi.prova(commessa.trim(), bozza.map(pulita))); } catch (e) { setProva(null); setErrore((e as Error).message); }
  }

  if (bozza === null) return <p className="py-10 text-center text-sm text-muted">Caricamento…</p>;
  const esitoDi = (i: number) => prova?.regole[i];

  return (
    <div>
      <datalist id="componenti-regole">{nomiComp.map(n => <option key={n} value={n} />)}</datalist>
      <datalist id="sigle-regole">{(prova?.sigle ?? []).map(s => <option key={s} value={s} />)}</datalist>
      <Errore messaggio={errore} />
      <div className="d-print-none mb-4 flex flex-wrap items-center gap-2">
        {puoModificare && <button className="btn-secondary" onClick={() => { setBozza(b => [...(b ?? []), nuova()]); setProva(null); }}>Aggiungi regola</button>}
        {puoModificare && sporca && <button className="btn-secondary" onClick={() => { const r = JSON.parse(salvate) as RegolaComp[]; imposta(r); setProva(null); }}>Annulla le modifiche</button>}
        {puoModificare && <button className="btn-primary" disabled={!sporca || occupato} onClick={salva}>{occupato ? 'Salvataggio…' : 'Salva le regole'}</button>}
        {sporca && <span className="text-xs text-warning">Modifiche non salvate</span>}
        {msg && !sporca && <span className="text-xs text-muted">{msg}</span>}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-3">
          {bozza.length === 0 && (
            <div className="rounded-card border border-line bg-white">
              <EmptyState title="Nessuna regola" hint="Una regola dice: SE la scheda ha (o non ha) certe sigle, ALLORA aggiungi un valore a un componente." />
            </div>
          )}
          {bozza.map((r, i) => {
            const e = esitoDi(i);
            return (
              <div key={r.k} className={`overflow-hidden rounded-card border border-line bg-white ${r.attiva ? '' : 'opacity-60'}`}>
                <div className="flex flex-wrap items-center gap-2 px-4 py-3">
                  <span className="w-6 text-center text-xs font-semibold text-muted tabular-nums">{i + 1}</span>
                  {puoModificare && (
                    <span className="flex gap-1">
                      <button className="btn-secondary !px-2 !py-0.5" disabled={i === 0} onClick={() => sposta(i, -1)} aria-label="Sposta su">↑</button>
                      <button className="btn-secondary !px-2 !py-0.5" disabled={i === bozza.length - 1} onClick={() => sposta(i, 1)} aria-label="Sposta giù">↓</button>
                    </span>
                  )}
                  <button className="min-w-0 flex-1 text-left" onClick={() => setBozza(b => b && b.map(x => (x.k === r.k ? { ...x, aperta: !x.aperta } : x)))} aria-expanded={r.aperta}>
                    <span className="font-semibold text-ink-900">{r.nome || '(senza nome)'}</span>
                    {r.modello !== '*' && <span className="ml-2 align-middle"><StatusBadge tone="info">{r.modello}</StatusBadge></span>}
                    {r.ferma && <span className="ml-2 align-middle"><StatusBadge tone="warning">Ferma le seguenti</StatusBadge></span>}
                    {!r.attiva && <span className="ml-2 align-middle"><StatusBadge tone="neutral">Disattivata</StatusBadge></span>}
                    {e && <span className="ml-2 align-middle"><StatusBadge tone={ESITO[e.esito].tono}>{ESITO[e.esito].testo}</StatusBadge></span>}
                    {!r.aperta && <Frase r={r} />}
                  </button>
                  {puoModificare && (
                    <label className="flex items-center gap-1.5 text-xs text-muted">
                      <input type="checkbox" checked={r.attiva} onChange={ev => modifica(r.k, x => ({ ...x, attiva: ev.target.checked }))} /> Attiva
                    </label>
                  )}
                  {puoModificare && <button className="btn-secondary !px-2 !py-0.5" aria-label="Elimina la regola"
                    onClick={() => { if (confirm(`Eliminare la regola «${r.nome}»?`)) { setBozza(b => b && b.filter(x => x.k !== r.k)); setProva(null); } }}>Elimina</button>}
                </div>

                {r.aperta && (
                  <fieldset disabled={!puoModificare} className="space-y-4 border-t border-line px-4 py-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <input className="input !w-72 !py-1" value={r.nome} aria-label="Nome della regola" onChange={ev => modifica(r.k, x => ({ ...x, nome: ev.target.value }))} />
                      <label className="flex items-center gap-2 text-sm text-muted">Vale per
                        <select className="input !w-auto !py-1" value={r.modello} onChange={ev => modifica(r.k, x => ({ ...x, modello: ev.target.value }))}>
                          <option value="*">tutti i modelli</option>
                          {[...new Set([...modelli, ...(r.modello !== '*' ? [r.modello] : [])])].map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </label>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm font-semibold text-ink-700">SE
                        <select className="input !w-auto !py-1" value={r.logica} aria-label="Quante condizioni"
                          onChange={ev => modifica(r.k, x => ({ ...x, logica: ev.target.value as 'tutte' | 'qualsiasi' }))}>
                          <option value="tutte">tutte queste condizioni sono vere</option><option value="qualsiasi">almeno una di queste è vera</option>
                        </select>
                      </div>
                      {r.condizioni.map((c, ci) => (
                        <CondizioneRiga key={ci} c={c} onChange={n => modifica(r.k, x => ({ ...x, condizioni: x.condizioni.map((y, j) => (j === ci ? n : y)) }))}
                          onTogli={() => modifica(r.k, x => ({ ...x, condizioni: x.condizioni.filter((_, j) => j !== ci) }))} />
                      ))}
                      <button type="button" className="text-xs font-semibold text-accent-ink hover:underline" onClick={() => modifica(r.k, x => ({ ...x, condizioni: [...x.condizioni, { tipo: 'presente', sigla: '' }] }))}>+ Condizione</button>
                      {r.condizioni.length === 0 && <span className="ml-3 text-xs text-muted">Senza condizioni la regola vale per ogni scheda.</span>}
                    </div>

                    <div className="space-y-2">
                      <div className="text-sm font-semibold text-ink-700">SALVO SE <span className="font-normal text-muted">(eccezioni, facoltative)</span></div>
                      {r.eccezioni.map((c, ci) => (
                        <CondizioneRiga key={ci} c={c} onChange={n => modifica(r.k, x => ({ ...x, eccezioni: x.eccezioni.map((y, j) => (j === ci ? n : y)) }))}
                          onTogli={() => modifica(r.k, x => ({ ...x, eccezioni: x.eccezioni.filter((_, j) => j !== ci) }))} />
                      ))}
                      <button type="button" className="text-xs font-semibold text-accent-ink hover:underline" onClick={() => modifica(r.k, x => ({ ...x, eccezioni: [...x.eccezioni, { tipo: 'presente', sigla: '' }] }))}>+ Eccezione</button>
                    </div>

                    <div className="space-y-2">
                      <div className="text-sm font-semibold text-ink-700">ALLORA</div>
                      {r.azioni.map((a, ai) => (
                        <AzioneRiga key={ai} a={a} onChange={n => modifica(r.k, x => ({ ...x, azioni: x.azioni.map((y, j) => (j === ai ? n : y)) }))}
                          onTogli={() => modifica(r.k, x => ({ ...x, azioni: x.azioni.filter((_, j) => j !== ai) }))} />
                      ))}
                      <button type="button" className="text-xs font-semibold text-accent-ink hover:underline" onClick={() => modifica(r.k, x => ({ ...x, azioni: [...x.azioni, { componente: '', valore: { tipo: 'sigla', sigla: '' } }] }))}>+ Azione</button>
                    </div>

                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" className="mt-1" checked={r.ferma} onChange={ev => modifica(r.k, x => ({ ...x, ferma: ev.target.checked }))} />
                      <span><b>Dopo questa regola, non applicare le seguenti</b> <span className="text-muted">(se scatta). Serve per le regole specifiche: mettila sopra a quella generale.</span></span>
                    </label>
                  </fieldset>
                )}
                {e && (e.condizioni.length > 0 || e.eccezioni.length > 0) && (
                  <ul className="border-t border-line bg-stone-50 px-4 py-2 text-xs text-ink-700">
                    {e.condizioni.map((c, j) => <li key={`c${j}`}><span className={c.vera ? 'text-success' : 'text-danger'}>{c.vera ? '✓' : '✗'}</span> {c.testo}</li>)}
                    {e.eccezioni.map((c, j) => <li key={`e${j}`}><span className={c.vera ? 'text-warning' : 'text-muted'}>{c.vera ? '⚠' : '–'}</span> eccezione: {c.testo}</li>)}
                  </ul>
                )}
              </div>
            );
          })}
        </div>

        <aside className="d-print-none h-fit rounded-card border border-line bg-white p-4 lg:sticky lg:top-4">
          <h2 className="text-sm font-semibold text-ink-900">Prova su una commessa</h2>
          <p className="mt-1 text-xs text-muted">Usa le regole come le vedi ora, anche se non le hai ancora salvate.</p>
          <form className="mt-3 flex gap-2" onSubmit={ev => { ev.preventDefault(); void provaOra(); }}>
            <input className="input !py-1" placeholder="Commessa…" value={commessa} onChange={ev => setCommessa(ev.target.value)} aria-label="Commessa da provare" />
            <button className="btn-primary !py-1" type="submit" disabled={!commessa.trim()}>Prova</button>
          </form>
          {prova && (
            <div className="mt-4 space-y-3 text-sm">
              <p className="text-xs text-muted">Commessa {prova.commessa} · modello {prova.modello}</p>
              <div>
                <div className="mb-1 text-xs font-semibold text-ink-700">Cosa ha trovato la VM ({prova.sigle.length} sigle)</div>
                <p className="flex flex-wrap gap-1">{prova.sigle.map(s => <span key={s} className="rounded-ctl bg-stone-100 px-1.5 py-0.5 font-mono text-xs">{s}</span>)}</p>
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold text-ink-700">Risultato</div>
                {Object.keys(prova.celle).length === 0 ? <p className="text-xs text-muted">Nessuna regola ha aggiunto niente.</p> : (
                  <dl className="space-y-1.5">
                    {Object.entries(prova.celle).map(([comp, voci]) => (
                      <div key={comp}><dt className="font-semibold">{comp}</dt>
                        <dd><ValoriComp voci={voci} /></dd></div>
                    ))}
                  </dl>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

export function ValoriComp({ voci }: { voci: VoceComp[] }) {
  return (
    <ul className="space-y-0.5">
      {voci.map(v => (
        <li key={v.testo} title={`Prodotto da: ${v.regole.map(r => r.nome).join(', ')}`}>
          <span className="font-semibold">{v.testo}</span>
          {v.descrizione && <span className="ml-1.5 text-xs text-muted">{v.descrizione}</span>}
        </li>
      ))}
    </ul>
  );
}

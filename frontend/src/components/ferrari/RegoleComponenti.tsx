'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import {
  descriviAzione, descriviCondizione, ESITO, perApi, regoleApi,
  type Azione, type Condizione, type ProvaRegole, type RegolaComp, type VoceComp,
} from '@/lib/ferrari-regole';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
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

  const azioniPagina = puoModificare && (
    <>
      {sporca && <button className="btn-secondary" onClick={() => { imposta(JSON.parse(salvate) as RegolaComp[]); setProva(null); }}>Annulla</button>}
      <button className="btn-secondary" onClick={() => { setBozza(b => [...(b ?? []), nuova()]); setProva(null); }}>Nuova regola</button>
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
        <div className="max-w-4xl space-y-4">
          <form className="d-print-none flex flex-wrap items-center gap-2" onSubmit={ev => { ev.preventDefault(); void provaOra(); }}>
            <input className="input !w-60 !py-1.5" placeholder="Prova con una commessa…" value={commessa} onChange={ev => setCommessa(ev.target.value)} aria-label="Commessa da provare" />
            <button className="btn-secondary" type="submit" disabled={!commessa.trim() || bozza.length === 0}>Prova</button>
          </form>

          {prova && (
            <div className="rounded-card border border-line bg-white p-4 text-sm">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <b>Commessa {prova.commessa}</b>
                <button className="text-xs text-muted hover:text-ink-900" onClick={() => setProva(null)}>Chiudi</button>
              </div>
              {Object.keys(prova.celle).length === 0 ? <p className="text-muted">Nessuna regola ha aggiunto niente.</p> : (
                <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[auto_1fr]">
                  {Object.entries(prova.celle).map(([comp, voci]) => (
                    <div key={comp} className="contents"><dt className="font-semibold">{comp}</dt><dd><ValoriComp voci={voci} /></dd></div>
                  ))}
                </dl>
              )}
              <details className="mt-3 text-xs text-muted">
                <summary className="cursor-pointer">Sigle trovate nella scheda ({prova.sigle.length})</summary>
                <p className="mt-1 flex flex-wrap gap-1">{prova.sigle.map(s => <span key={s} className="rounded-ctl bg-stone-100 px-1.5 py-0.5 font-mono text-ink-700">{s}</span>)}</p>
              </details>
            </div>
          )}

          {bozza.length === 0 ? (
            <div className="rounded-card border border-line bg-white">
              <EmptyState title="Nessuna regola" hint="Esempio: se la scheda ha AS06, aggiungi AS06 a Paraurti."
                action={puoModificare ? <button className="btn-primary" onClick={() => setBozza([nuova()])}>Nuova regola</button> : undefined} />
            </div>
          ) : (
            <ol className="divide-y divide-line overflow-hidden rounded-card border border-line bg-white">
              {bozza.map((r, i) => {
                const e = prova?.regole[i];
                return (
                  <li key={r.k} className={r.attiva ? '' : 'bg-stone-50'}>
                    <div className="flex items-center gap-3 px-4 py-3">
                      <span className="w-5 shrink-0 text-center text-xs tabular-nums text-muted">{i + 1}</span>
                      <button className="min-w-0 flex-1 text-left" onClick={() => setBozza(b => b && b.map(x => (x.k === r.k ? { ...x, aperta: !x.aperta } : x)))} aria-expanded={r.aperta}>
                        <span className={`text-sm ${r.attiva ? 'text-ink-900' : 'text-muted line-through'}`}>{frase(r)}</span>
                        <span className="ml-2 text-xs text-muted">
                          {r.modello !== '*' && <span className="mr-2">solo {r.modello}</span>}
                          {r.ferma && <span className="mr-2">ferma le seguenti</span>}
                        </span>
                      </button>
                      {e && <span className={`shrink-0 text-xs font-medium ${e.esito === 'scattata' ? 'text-success' : 'text-muted'}`}>{ESITO[e.esito].testo}</span>}
                      {puoModificare && (
                        <span className="flex shrink-0 items-center gap-1 text-muted">
                          <button className="px-1.5 hover:text-ink-900 disabled:opacity-30" disabled={i === 0} onClick={() => sposta(i, -1)} aria-label="Sposta su">↑</button>
                          <button className="px-1.5 hover:text-ink-900 disabled:opacity-30" disabled={i === bozza.length - 1} onClick={() => sposta(i, 1)} aria-label="Sposta giù">↓</button>
                          <label className="ml-1 flex cursor-pointer items-center gap-1 text-xs"><input type="checkbox" checked={r.attiva} aria-label="Attiva"
                            onChange={ev => modifica(r.k, x => ({ ...x, attiva: ev.target.checked }))} />attiva</label>
                        </span>
                      )}
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
          )}
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

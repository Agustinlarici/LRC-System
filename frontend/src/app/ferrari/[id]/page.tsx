'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/ui/Toast';
import { usePromptDialog } from '@/components/ui/PromptDialog';
import {
  fmtData, scaricaFile,
  type AnalisiVm, type ComponenteVm, type DecisioneRec, type DettaglioFile, type ItemConfronto, type OpzioneVm, type UnitaTesto,
} from '@/lib/ferrari';
import { Errore, EsitoDot, FerrariNav, StatoBadge } from '@/components/ferrari/Comuni';
import { ItemCard } from '@/components/ferrari/ItemCard';

const IA_STATO = { in_attesa: 'in attesa di risposta', ricevuta: 'risposta ricevuta', assente: 'assente (solo VM)' } as const;

export default function SchedaPage() {
  const { id: idParam } = useParams<{ id: string }>();
  const id = Number(idParam);
  const { canManage } = useAuth();
  const toast = useToast();
  const { ask, dialog } = usePromptDialog();
  const puoOperare = canManage('ferrari_schede');

  const [d, setD] = useState<DettaglioFile | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [occupato, setOccupato] = useState(false);
  const [soloProblemi, setSoloProblemi] = useState(false);
  const [confermaBulk, setConfermaBulk] = useState(false);

  const carica = useCallback(async () => {
    try {
      setD(await api.get<DettaglioFile>(`/api/ferrari/files/${id}`));
      setErrore(null);
    } catch (e) {
      setErrore((e as Error).message);
    }
  }, [id]);

  useEffect(() => { if (Number.isInteger(id) && id > 0) carica(); }, [id, carica]);

  const vm: AnalisiVm | null = d ? (d.vm_confronto ?? d.vm?.risultato ?? null) : null;
  const items = useMemo(() => d?.confronto?.risultato.items ?? [], [d]);
  const ultime = useMemo(() => {
    const m = new Map<string, DecisioneRec>();
    for (const x of d?.decisioni ?? []) m.set(x.item_key, x);
    return m;
  }, [d]);
  const risolti = items.filter(i => ultime.has(i.key)).length;
  const aperti = items.length - risolti;
  const inRevisione = d?.file.stato === 'IN_REVISIONE';
  const modifica = !!puoOperare && inRevisione;
  const righeEsito = useMemo(() => new Map((d?.confronto?.risultato.righe ?? []).map(r => [r.riga, r.esito])), [d]);
  const iaPerRiga = useMemo(() => new Map((d?.ia?.risultato.opzioni ?? []).map(o => [o.riga, o])), [d]);

  async function azione(chiave: string, fn: () => Promise<unknown>, ok?: string) {
    setOccupato(true);
    try { await fn(); if (ok) toast.success(ok); await carica(); } catch (e) { toast.error((e as Error).message); } finally { setOccupato(false); }
  }

  const valida = () => azione('valida', () => api.post(`/api/ferrari/files/${id}/valida`, { rev: d!.file.rev }), 'Scheda validata');
  const rianalizza = () => azione('rianalizza', () => api.post(`/api/ferrari/files/${id}/rianalizza`), 'Analisi ricalcolata con la conoscenza attuale');
  const reinvia = () => azione('reinvia', () => api.post(`/api/ferrari/files/${id}/reinvia-ia`), 'La scheda torna in attesa della IA: le decisioni già prese si mantengono');
  const soloVm = () => azione('solovm', () => api.post(`/api/ferrari/files/${id}/solo-vm`), 'Scheda in revisione senza IA');
  async function rifiuta() {
    const motivo = await ask({ title: 'Rifiuta la scheda', message: 'La scheda si chiude e non viene usata. Il motivo resta nello storico.', label: 'Motivo', confirmLabel: 'Rifiuta' });
    if (typeof motivo !== 'string' || !motivo.trim()) return;
    await azione('rifiuta', () => api.post(`/api/ferrari/files/${id}/rifiuta`, { rev: d!.file.rev, motivo: motivo.trim() }), 'Scheda rifiutata');
  }

  /** Propone in blocco tutti i codici ancora sconosciuti usando la descrizione scritta da Ferrari. */
  async function proponiCodici() {
    if (!d || !vm) return;
    setOccupato(true);
    setConfermaBulk(false);
    try {
      let rev = d.file.rev;
      let n = 0;
      for (const it of items.filter(i => i.tipo === 'codice_ignoto' && !ultime.has(i.key))) {
        const opz = vm.opzioni.find(o => o.riga === it.riga);
        const significato = opz?.descrizione.trim();
        if (!significato || !it.codice) continue;
        const r = await api.post<{ rev: number }>(`/api/ferrari/files/${id}/decisioni`, {
          rev, item_key: it.key, decisione: 'correggi', valore_dopo: { significato }, motivo: null,
          proposta: { tipo: 'codice', ambito: 'TUTTI', codice: it.codice, significato },
        });
        rev = r.rev;
        n++;
      }
      toast.success(`${n} codici proposti: il supervisore deve approvarli`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setOccupato(false);
      await carica();
    }
  }

  if (!Number.isInteger(id) || id <= 0) return <Errore messaggio="ID non valido" />;
  if (!d) return <div><FerrariNav /><Errore messaggio={errore} />{!errore && <p className="text-gray-400">Caricamento…</p>}</div>;

  const f = d.file;
  const itemScheda = items.filter(i => i.riga === null);
  const codiciIgnoti = items.filter(i => i.tipo === 'codice_ignoto' && !ultime.has(i.key)).length;
  const h = vm?.header;

  return (
    <div>
      <div className="mb-2">
        <Link href="/ferrari/schede" className="inline-flex items-center gap-1 text-sm font-medium px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-700 hover:bg-gray-50">← Revisione</Link>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex flex-wrap items-center gap-3">
            Commessa {f.commessa ?? '—'} <StatoBadge stato={f.stato} /> <EsitoDot esito={f.esito} />
          </h1>
          <p className="mt-1 text-gray-500">{f.modello} · {f.versione} · {f.paese} · matricola {f.matricola ?? '—'}</p>
          <p className="text-xs text-gray-400 mt-0.5">{f.filename} · ricevuta {fmtData(f.caricato_at)} da {f.caricato_da} · IA: {IA_STATO[f.ia_stato]}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary text-sm" onClick={() => scaricaFile(`/api/ferrari/files/${id}/original`, { nome: f.filename }).catch(e => toast.error((e as Error).message))}>Originale</button>
          {puoOperare && ['IN_ATTESA_IA', 'IN_REVISIONE', 'ACCETTATO_AUTO'].includes(f.stato) && (
            <button className="btn-secondary text-sm" disabled={occupato} onClick={rianalizza} title="Rilegge la scheda con le regole approvate fino ad ora">Rianalizza</button>
          )}
          {puoOperare && ['IN_REVISIONE', 'ACCETTATO_AUTO'].includes(f.stato) && f.ia_stato !== 'in_attesa' && (
            <button className="btn-secondary text-sm" disabled={occupato} onClick={reinvia}
              title="Rimanda la scheda alla IA (es. risposta incompleta). Le decisioni già prese restano.">Rimanda alla IA</button>
          )}
          {puoOperare && f.stato === 'IN_ATTESA_IA' && (
            <button className="btn-secondary text-sm" disabled={occupato} onClick={soloVm}>Rivedi senza IA</button>
          )}
          {puoOperare && !['VALIDATO', 'RIFIUTATO', 'SOSTITUITO'].includes(f.stato) && (
            <button className="btn-danger text-sm" disabled={occupato} onClick={rifiuta}>Rifiuta</button>
          )}
          {modifica && (
            <button className="btn-primary text-sm" disabled={occupato || aperti > 0} onClick={valida}
              title={aperti > 0 ? `Restano ${aperti} elementi da rivedere` : 'Conferma la scheda'}>
              {items.length === 0 ? 'Conferma (controllo a campione)' : 'Valida scheda'}
            </button>
          )}
        </div>
      </div>
      <FerrariNav />
      <Errore messaggio={errore} />

      {f.stato === 'QUARANTENA' && (
        <div className="card border-red-300 bg-red-50 text-red-800 mb-6">
          <h2 className="font-semibold mb-1">File in quarantena</h2>
          <p className="text-sm">{f.quarantena_motivo}</p>
          <p className="text-xs mt-2">Non viene analizzato. Chiedi a Ferrari un file corretto o avvisa l&apos;IT.</p>
        </div>
      )}
      {f.sostituito_da && (
        <div className="mb-4 rounded-lg bg-gray-100 border border-gray-200 px-4 py-2 text-sm text-gray-600">
          Questa scheda è stata sostituita da una versione più recente: <Link className="text-blue-700 hover:underline" href={`/ferrari/${f.sostituito_da}`}>scheda #{f.sostituito_da}</Link>.
        </div>
      )}
      {f.sostituisce && f.sostituisce.length > 0 && (
        <div className="mb-4 rounded-lg bg-sky-50 border border-sky-200 px-4 py-2 text-sm text-sky-800">
          Sostituisce {f.sostituisce.map(x => <Link key={x} className="underline mr-2" href={`/ferrari/${x}`}>scheda #{x}</Link>)}
        </div>
      )}
      {f.stato === 'IN_ATTESA_IA' && (
        <div className="mb-4 rounded-lg bg-sky-50 border border-sky-200 px-4 py-2 text-sm text-sky-800">
          {f.inviato_ia_at ? `Inviata alla IA il ${fmtData(f.inviato_ia_at)}.` : 'Non ancora inviata alla IA.'}{' '}
          <Link className="underline" href="/ferrari/scambio">Vai a Scambio con la IA</Link>
        </div>
      )}

      {vm && h && (
        <section className="card mb-6">
          <h2 className="font-semibold text-gray-900 mb-3">Testata e confronto</h2>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-sm mb-4">
            <Dato t="Modello" v={h.tipo_matricola.modello} />
            <Dato t="Versione" v={h.tipo_matricola.versione} />
            <Dato t="Matricola" v={h.tipo_matricola.matricola} />
            <Dato t="Progressivo" v={h.tipo_matricola.progressivo} />
            <Dato t="Destinazione" v={h.destinazione.paese} />
            <Dato t="Codice mercato" v={h.tipo_matricola.mercato_codice} />
            <Dato t="N. di telaio" v={h.telaio} />
            <Dato t="Variante" v={h.variante.codice ? `${h.variante.codice} (rev. ${h.variante.revisione ?? '?'})` : null} />
          </dl>
          <div className={`text-sm rounded px-3 py-2 mb-3 ${vm.mercato.coerente ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>
            Controllo mercato: {vm.mercato.coerente ? 'coerente' : 'INCOERENTE'} — {vm.mercato.dettaglio}
          </div>
          {d.confronto && d.confronto.risultato.header.length > 0 && (
            <table className="text-sm w-full max-w-xl mb-3">
              <thead><tr className="text-gray-500 text-left"><th className="font-medium pb-1">Campo</th><th className="font-medium pb-1">VM</th><th className="font-medium pb-1">IA</th><th className="font-medium pb-1">Esito</th></tr></thead>
              <tbody>
                {d.confronto.risultato.header.map(r => (
                  <tr key={r.campo} className="border-t border-gray-100">
                    <td className="py-1">{r.campo}</td><td>{r.vm ?? '—'}</td><td>{r.ia ?? '—'}</td>
                    <td className={r.stato === 'uguale' ? 'text-green-700' : 'text-red-600'}>{r.stato.replace(/_/g, ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-xs text-gray-400">
            Conoscenza: VM versione {d.confronto?.risultato.versioni.vm ?? vm.versione_conoscenza}
            {d.confronto && <> · IA versione {d.confronto.risultato.versioni.ia ?? '—'}</>}
            {d.confronti.length > 1 && <> · {d.confronti.length} confronti eseguiti</>}
          </p>
        </section>
      )}

      {d.confronto && f.stato !== 'QUARANTENA' && (
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="text-sm">
            <span className="font-semibold text-gray-900">{risolti} / {items.length}</span> elementi rivisti
            {items.length > 0 && (
              <span className="inline-block align-middle ml-2 w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
                <span className="block h-full bg-green-500" style={{ width: `${(risolti / items.length) * 100}%` }} />
              </span>
            )}
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={soloProblemi} onChange={e => setSoloProblemi(e.target.checked)} /> Mostra solo le righe con problemi
          </label>
          {modifica && codiciIgnoti > 0 && (
            confermaBulk ? (
              <span className="text-sm flex items-center gap-2">
                Proporre {codiciIgnoti} codici con la descrizione scritta da Ferrari (valgono per tutti i modelli)?
                <button className="btn-primary text-xs" disabled={occupato} onClick={proponiCodici}>Sì, proponi</button>
                <button className="btn-secondary text-xs" onClick={() => setConfermaBulk(false)}>No</button>
              </span>
            ) : (
              <button className="btn-secondary text-xs" disabled={occupato} onClick={() => setConfermaBulk(true)}>Proponi tutti i {codiciIgnoti} codici ignoti</button>
            )
          )}
          <Legenda />
        </div>
      )}

      {itemScheda.length > 0 && (
        <section className="mb-6 space-y-2">
          <h2 className="font-semibold text-gray-900">Problemi della scheda</h2>
          {itemScheda.map(it => (
            <ItemCard key={it.key} item={it} ultima={ultime.get(it.key)} abilitato={modifica} fileId={id} rev={f.rev}
              modello={f.modello} onSalvato={carica} onErrore={m => toast.error(m)} />
          ))}
        </section>
      )}

      {vm && d.confronto && (
        <section className="mb-8">
          <h2 className="font-semibold text-gray-900 mb-2">Allestimento</h2>
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {vm.opzioni.map((o, idx) => {
              const itemsRiga = items.filter(i => i.riga === o.riga);
              const esito = righeEsito.get(o.riga) ?? 'VERDE';
              if (soloProblemi && itemsRiga.length === 0) return null;
              const nuovaSezione = idx === 0 || vm.opzioni[idx - 1]!.sezione !== o.sezione;
              return (
                <div key={o.riga}>
                  {nuovaSezione && o.sezione && <div className="px-4 py-1.5 bg-gray-50 text-xs font-semibold tracking-wide text-gray-500 uppercase">{o.sezione}</div>}
                  <Opzione o={o} esito={esito} ia={iaPerRiga.get(o.riga)?.componenti}>
                    {itemsRiga.length > 0 && (
                      <div className="mt-2 space-y-2">
                        {itemsRiga.map(it => (
                          <ItemCard key={it.key} item={it} ultima={ultime.get(it.key)} abilitato={modifica} fileId={id} rev={f.rev}
                            modello={f.modello} opzione={o} testoUnita={testoDelItem(o, it)} onSalvato={carica} onErrore={m => toast.error(m)} />
                        ))}
                      </div>
                    )}
                  </Opzione>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {f.dati_validati && (
        <section className="card mb-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold text-gray-900">Dati validati ({f.dati_validati.validazione === 'automatica' ? 'accettazione automatica' : 'revisione umana'})</h2>
            <button className="btn-secondary text-xs" onClick={() => {
              const blob = new Blob([JSON.stringify(f.dati_validati, null, 2)], { type: 'application/json' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = `scheda_${f.commessa ?? f.id}_validata.json`;
              a.click();
              URL.revokeObjectURL(a.href);
            }}>Scarica JSON</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-gray-500 border-b border-gray-200"><th className="py-1 pr-3 font-medium">Codice</th><th className="py-1 pr-3 font-medium">Descrizione</th><th className="py-1 pr-3 font-medium">Valore</th><th className="py-1 font-medium">Componenti</th></tr></thead>
              <tbody>
                {f.dati_validati.opzioni.map(o => (
                  <tr key={o.riga} className="border-b border-gray-100 align-top">
                    <td className="py-1.5 pr-3 font-mono font-medium">{o.codice}</td>
                    <td className="py-1.5 pr-3">{o.significato ?? o.descrizione}</td>
                    <td className="py-1.5 pr-3">{o.valore}</td>
                    <td className="py-1.5">{o.componenti.map((c, i) => (
                      <span key={i} className="inline-block mr-1 mb-1 px-1.5 py-0.5 rounded bg-blue-50 text-blue-800 text-xs" title={`fonte: ${c.fonte}`}>{c.tipo}: {c.valore}</span>
                    ))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <details className="card mb-6">
        <summary className="cursor-pointer font-semibold text-gray-900">Storico della scheda ({d.storico.length})</summary>
        <table className="w-full text-sm mt-3">
          <tbody>
            {d.storico.map(s => (
              <tr key={s.id} className="border-b border-gray-100 align-top">
                <td className="py-1.5 pr-3 text-gray-400 whitespace-nowrap">{fmtData(s.ts)}</td>
                <td className="py-1.5 pr-3">{s.username ?? 'sistema'}</td>
                <td className="py-1.5 pr-3 font-mono text-xs">{s.azione}</td>
                <td className="py-1.5 text-xs text-gray-500 break-all">{s.dettagli ? JSON.stringify(s.dettagli) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      {dialog}
    </div>
  );
}

function testoDelItem(o: OpzioneVm, it: ItemConfronto): string {
  const u = o.unita.find(x => x.origine === it.origine && x.n === (it.blocco ?? 0));
  return u?.testo ?? '';
}

function Dato({ t, v }: { t: string; v: string | null | undefined }) {
  return <div><dt className="text-xs text-gray-400">{t}</dt><dd className="font-medium text-gray-900">{v || '—'}</dd></div>;
}

function Legenda() {
  return (
    <span className="text-[11px] text-gray-500 flex items-center gap-2 ml-auto">
      <span className="px-1 rounded bg-blue-100 text-blue-900">riconosciuto</span>
      <span className="px-1 rounded bg-amber-200 text-amber-950">sconosciuto</span>
      <span className="px-1 rounded bg-red-200 text-red-900">immagini / segnaposto</span>
    </span>
  );
}

const POSTO = { valore: 'colonna C · valore', nota: 'colonna D · nota', blocco: 'testo libero' } as const;

function Opzione({ o, esito, ia, children }: {
  o: OpzioneVm; esito: 'VERDE' | 'AMBRA' | 'ROSSO'; ia?: { tipo: string; valore: string; frammento: string }[]; children?: React.ReactNode;
}) {
  return (
    <div className="px-4 py-3">
      <div className="grid grid-cols-[3.5rem_1fr] sm:grid-cols-[3.5rem_1.2fr_1fr_1fr_1.5rem] gap-x-4 gap-y-1 items-baseline text-sm">
        <span className={`font-mono font-semibold ${o.codice_noto ? 'text-gray-900' : 'text-amber-700'}`} title={o.codice_noto ? (o.significato ?? '') : 'Codice non ancora approvato'}>{o.codice}</span>
        <span className="text-gray-800">{o.descrizione}{o.significato && o.significato !== o.descrizione && <span className="text-gray-400 text-xs"> · {o.significato}</span>}</span>
        <span className="text-gray-700">{o.valore}</span>
        <span className="text-gray-500">{o.nota}</span>
        <span className="justify-self-end"><EsitoDot esito={esito} mostraTesto={false} /></span>
      </div>

      {o.unita.map((u, i) => (
        <div key={i} className="mt-2 rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2">
          <div className="text-[11px] text-yellow-800/80 mb-0.5">
            {POSTO[u.origine]}{u.origine === 'blocco' && ` · riga ${u.righe[0]}${u.righe.length > 1 ? `–${u.righe[u.righe.length - 1]}` : ''}`}
          </div>
          <div className="text-sm leading-relaxed text-gray-900"><TestoEvidenziato u={u} /></div>
        </div>
      ))}

      {ia && ia.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
          <span className="font-semibold text-emerald-700 mr-1">IA:</span>
          {ia.map((c, i) => <span key={i} className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200" title={c.frammento}>{c.tipo}: {c.valore}</span>)}
        </div>
      )}
      {children}
    </div>
  );
}

function TestoEvidenziato({ u }: { u: UnitaTesto }) {
  type Marca = { start: number; end: number; cls: string; title: string };
  const marche: Marca[] = [
    ...u.componenti.map((c: ComponenteVm) => ({
      start: c.start, end: c.end, title: `${c.tipo}: ${c.valore}`,
      cls: c.tipo === 'RIFERIMENTO_IMMAGINI' || c.tipo === 'PLACEHOLDER' ? 'bg-red-200 text-red-900' : 'bg-blue-100 text-blue-900',
    })),
    ...u.residuo.map(r => ({ start: r.start, end: r.end, title: 'Non riconosciuto', cls: 'bg-amber-200 text-amber-950' })),
  ].sort((a, b) => a.start - b.start);

  const parti: React.ReactNode[] = [];
  let pos = 0;
  marche.forEach((m, i) => {
    if (m.start < pos || m.end > u.testo.length) return;
    if (m.start > pos) parti.push(<span key={`t${i}`}>{u.testo.slice(pos, m.start)}</span>);
    parti.push(<mark key={`m${i}`} title={m.title} className={`rounded px-0.5 ${m.cls}`}>{u.testo.slice(m.start, m.end)}</mark>);
    pos = m.end;
  });
  if (pos < u.testo.length) parti.push(<span key="fine">{u.testo.slice(pos)}</span>);
  return <>{parti}</>;
}

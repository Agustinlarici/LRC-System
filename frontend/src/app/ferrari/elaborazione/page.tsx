'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { Errore } from '@/components/ferrari/Comuni';
import { TappeIa } from '@/components/ferrari/TappeIa';
import { IconaAggiorna } from '@/components/ferrari/Icone';
import { iaApi, STATI_IN_CORSO, TIPO_DISCREPANZA, type DettaglioJob, type SchedaIa, type StatoIa } from '@/lib/ferrari-ia';

const quando = (iso: string) => new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const TONO_PASSO = { in_corso: 'info', ok: 'success', attenzione: 'warning', errore: 'danger', saltato: 'neutral' } as const;

function Riepilogo({ stato }: { stato: StatoIa }) {
  const c = stato.contatori;
  const voci = [
    { k: 'In corso', n: (c.in_coda ?? 0) + (c.inviato ?? 0) + (c.in_analisi ?? 0) + (c.confronto ?? 0), cls: 'text-accent-ink' },
    { k: 'IA in attesa', n: c.attesa_ia ?? 0, cls: 'text-warning' },
    { k: 'Errori', n: c.errore ?? 0, cls: 'text-danger' },
    { k: 'Pronte con IA', n: c.fatto ?? 0, cls: 'text-success' },
  ];
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {voci.map(v => (
        <div key={v.k} className="rounded-card border border-line bg-white px-4 py-3 shadow-card">
          <p className="text-xs text-muted">{v.k}</p>
          <p className={`text-2xl font-semibold tabular-nums ${v.n ? v.cls : 'text-stone-300'}`}>{v.n}</p>
        </div>
      ))}
    </div>
  );
}

function StatoIaBadge({ s }: { s: StatoIa | null }) {
  if (!s) return null;
  if (!s.config.attiva) return <StatusBadge tone="neutral">IA spenta</StatusBadge>;
  if (s.connessione.stato === 'non_raggiungibile') return <StatusBadge tone="warning">PC IA non raggiungibile</StatusBadge>;
  if (s.connessione.stato === 'ok') return <StatusBadge tone="success">IA attiva</StatusBadge>;
  return <StatusBadge tone="info">IA attiva</StatusBadge>;
}

function Dettaglio({ d }: { d: DettaglioJob | null }) {
  if (!d) return <p className="text-sm text-muted">Caricamento…</p>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Cosa e&apos; successo</h3>
        <ul className="space-y-1.5 text-sm">
          {d.passi.map((p, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="w-32 shrink-0 text-xs tabular-nums text-muted">{quando(p.at)}</span>
              <StatusBadge tone={TONO_PASSO[p.stato]}>{p.passo}</StatusBadge>
              <span className="min-w-0 text-ink-700">{p.dettaglio}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Confronto con la lettura della IA</h3>
        {!d.risultato ? <p className="text-sm text-muted">Non ancora disponibile.</p>
          : d.risultato.discrepanze.length === 0 ? <p className="text-sm text-success">Le due letture coincidono per ogni codice.</p> : (
            <table className="w-full text-xs">
              <thead><tr className="text-left text-muted"><th className="pb-1 pr-2 font-medium">Sigla</th><th className="pb-1 pr-2 font-medium">Differenza</th><th className="pb-1 font-medium">VM / IA</th></tr></thead>
              <tbody className="divide-y divide-line">
                {d.risultato.discrepanze.map((x, i) => (
                  <tr key={i} className="align-top">
                    <td className="py-1.5 pr-2 font-semibold">{x.codice}{x.peso === 'info' && <span className="ml-1 font-normal text-muted">(info)</span>}</td>
                    <td className="py-1.5 pr-2">{TIPO_DISCREPANZA[x.tipo]}<div className="text-muted">{x.dettaglio}</div></td>
                    <td className="py-1.5 text-muted">{x.vm !== undefined && <div>VM: {x.vm || '—'}</div>}{x.ia !== undefined && <div>IA: {x.ia || '—'}</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
      {d.risultato && (d.risultato.avvisi?.length ?? 0) > 0 && (
        <div className="lg:col-span-2">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Avvisi della IA</h3>
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted"><th className="pb-1 pr-2 font-medium">Sigla</th><th className="pb-1 pr-2 font-medium">Riga</th><th className="pb-1 font-medium">Avviso</th></tr></thead>
            <tbody className="divide-y divide-line">
              {d.risultato.avvisi!.map((a, i) => (
                <tr key={i} className="align-top">
                  <td className="py-1.5 pr-2 font-semibold">{a.codice ?? '—'}</td>
                  <td className="py-1.5 pr-2 tabular-nums text-muted">{a.riga ?? ''}</td>
                  <td className="py-1.5 text-ink-700">{a.motivo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function ElaborazionePage() {
  const { canManage } = useAuth();
  const puoGestire = canManage('ferrari_schede');
  const [schede, setSchede] = useState<SchedaIa[] | null>(null);
  const [stato, setStato] = useState<StatoIa | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [aperta, setAperta] = useState<string | null>(null);
  const [dettaglio, setDettaglio] = useState<DettaglioJob | null>(null);
  const [occupato, setOccupato] = useState(false);

  const carica = useCallback(async () => {
    try {
      const [s, st] = await Promise.all([iaApi.schede(), iaApi.stato()]);
      setSchede(s); setStato(st); setErrore(null);
    } catch (e) { setErrore((e as Error).message); }
  }, []);

  // aggiornamento: ogni 2 secondi se c'e' lavoro in corso, altrimenti ogni 15
  const inCorso = !!schede?.some(s => s.stato && STATI_IN_CORSO.includes(s.stato));
  useEffect(() => {
    carica();
    const t = setInterval(carica, inCorso ? 2000 : 15000);
    return () => clearInterval(t);
  }, [carica, inCorso]);

  const jobAperto = schede?.find(s => (s.job_id ?? `f${s.file_id}`) === aperta)?.job_id ?? null;
  const statoAperto = schede?.find(s => (s.job_id ?? `f${s.file_id}`) === aperta)?.stato;
  useEffect(() => {
    if (!jobAperto) { setDettaglio(null); return; }
    let vivo = true;
    iaApi.dettaglio(jobAperto).then(d => { if (vivo) setDettaglio(d); }).catch(() => {});
    return () => { vivo = false; };
  }, [jobAperto, statoAperto]);

  async function azione(f: () => Promise<unknown>) {
    setOccupato(true);
    try { await f(); setErrore(null); await carica(); } catch (e) { setErrore((e as Error).message); } finally { setOccupato(false); }
  }

  const attiva = !!stato?.config.attiva;

  return (
    <div>
      <PageHeader
        back={{ label: 'Programma produzione (schede)', href: '/ferrari' }}
        title="Elaborazione"
        badge={<StatoIaBadge s={stato} />}
        description="Cosa sta facendo il programma con ogni scheda, tappa per tappa."
        actions={
          <>
            <Button onClick={carica} aria-label="Aggiorna"><IconaAggiorna /> Aggiorna</Button>
            {puoGestire && attiva && <Button disabled={occupato} onClick={() => azione(async () => { const r = await iaApi.accodaMancanti(); setErrore(r.accodate ? null : 'Tutte le schede hanno gia\' un\'analisi'); })}>Analizza le schede mancanti</Button>}
            {puoGestire && <Button href="/ferrari/impostazioni#avanzate">Impostazioni IA</Button>}
          </>
        }
      />
      <Errore messaggio={errore} />

      {stato?.config.attiva && stato.connessione.stato === 'non_raggiungibile' && (
        <div className="mb-4 rounded-card border border-warning/30 bg-warning-soft px-4 py-2.5 text-sm text-warning">
          La PC IA non risponde{stato.connessione.errore ? ` (${stato.connessione.errore})` : ''}. Le schede si leggono lo stesso; la IA riprovera&apos; da sola.
        </div>
      )}
      {stato && !stato.config.attiva && (
        <div className="mb-4 rounded-card border border-line bg-white px-4 py-2.5 text-sm text-muted">
          L&apos;analisi con IA e&apos; spenta: le schede sono pronte appena lette. {puoGestire && <Link href="/ferrari/impostazioni#avanzate" className="font-medium text-accent-ink underline">Accendila nelle Impostazioni</Link>}
        </div>
      )}
      {stato && <Riepilogo stato={stato} />}

      <div className="overflow-x-auto rounded-card border border-line bg-white shadow-card">
        {!schede ? <SkeletonTable rows={6} cols={3} /> : schede.length === 0 ? (
          <EmptyState title="Nessuna scheda ancora" hint="Quando carichi un Excel o il programma legge la cartella, qui vedi le tappe di ogni scheda." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-stone-50 text-left text-muted">
                <th className="px-4 py-2.5 font-medium">Scheda</th><th className="px-4 py-2.5 font-medium">Tappe</th><th className="px-4 py-2.5 text-right font-medium">Azioni</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {schede.map(s => {
                const chiave = s.job_id ?? `f${s.file_id}`;
                const espandi = aperta === chiave;
                return (
                  <Fragment key={chiave}>
                    <tr className="align-middle hover:bg-stone-50">
                      <td className="px-4 py-3">
                        <button className="text-left" onClick={() => setAperta(espandi ? null : chiave)} aria-expanded={espandi} disabled={!s.job_id}>
                          <span className="block font-semibold text-ink-900">{s.commessa ?? '—'} <span className="font-normal text-muted">{s.modello}</span></span>
                          <span className="block max-w-[14rem] truncate text-xs text-muted">{s.filename}</span>
                        </button>
                        {s.n_avvisi > 0 && <span className="mt-1 block text-xs font-medium text-warning">{s.n_avvisi} {s.n_avvisi === 1 ? 'avviso' : 'avvisi'} della IA</span>}
                      </td>
                      <td className="px-4 py-3"><TappeIa tappe={s.tappe} /></td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {puoGestire && s.job_id && (s.stato === 'errore' || s.stato === 'attesa_ia') && <Button disabled={occupato} onClick={() => azione(() => iaApi.riprova(s.job_id!))}>Riprova</Button>}
                        {puoGestire && s.job_id && (s.stato === 'in_coda' || s.stato === 'inviato' || s.stato === 'in_analisi' || s.stato === 'attesa_ia') && <Button variant="ghost" disabled={occupato} onClick={() => azione(() => iaApi.annulla(s.job_id!))}>Annulla</Button>}
                        {puoGestire && attiva && (!s.job_id || s.stato === 'fatto' || s.stato === 'annullato') && <Button variant="ghost" disabled={occupato} onClick={() => azione(() => iaApi.analizza(s.file_id))}>{s.stato === 'fatto' ? 'Rianalizza' : 'Analizza con IA'}</Button>}
                      </td>
                    </tr>
                    {espandi && <tr><td colSpan={3} className="bg-stone-50 px-4 py-4"><Dettaglio d={dettaglio} /></td></tr>}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

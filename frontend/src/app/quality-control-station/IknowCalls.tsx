'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';

type Call = {
  id: number; received_at: string; ip: string | null; http_status: number; esito: string; dettaglio: string | null;
  seriale: string | null; commessa: string | null; fase: string | null; componente: string | null; versione: string | null;
  data_ora: string | null; job_id: number | null;
};
type Data = { calls: Call[]; summary_24h: Record<string, number> };

// Esiti: etichetta e, dove serve, cosa controllare. Tono «danger» = iKnow non riesce a consegnare.
const ESITO: Record<string, { label: string; tone: Tone; hint?: string }> = {
  ok:                    { label: 'Ricevuta',              tone: 'success' },
  duplicata:             { label: 'Doppione',              tone: 'neutral', hint: 'Già ricevuta: nessun nuovo ordine' },
  fase_sconosciuta:      { label: 'Fase sconosciuta',      tone: 'warning', hint: 'Ordine messo da parte: crea la fase e premi Riprova' },
  ignorata_origine:      { label: 'Ignorata',              tone: 'warning', hint: 'L’origine non è «Chiamata API»' },
  token_errato:          { label: 'Token errato',          tone: 'danger',  hint: 'Il token di iKnow non coincide con quello salvato' },
  token_non_configurato: { label: 'Token non impostato',   tone: 'danger',  hint: 'Salva prima il token ricevuto da iKnow' },
  corpo_non_valido:      { label: 'Dati non validi',       tone: 'danger',  hint: 'Il contenuto della chiamata non è nel formato concordato' },
  errore_interno:        { label: 'Errore del sistema',    tone: 'danger',  hint: 'Vedi i log del backend' },
};

const fmt = (iso: string) => new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Ultime chiamate ricevute da iKnow (anche quelle rifiutate): serve a capire se arrivano e perché falliscono. */
export function IknowCalls() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<Data>('/api/quality-control-station/iknow/calls?limit=30'));
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Errore di caricamento'); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const summary = Object.entries(data?.summary_24h ?? {});

  return (
    <section className="card mb-6" aria-labelledby="iknow-calls-title">
      <div className="flex flex-wrap items-center justify-between gap-2 p-5 pb-3">
        <div>
          <h3 id="iknow-calls-title" className="font-medium text-ink-900">Chiamate ricevute da iKnow</h3>
          <p className="text-xs text-muted">Anche quelle rifiutate. Il token non viene mai salvato. Si conservano 30 giorni.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2" aria-label="Ultime 24 ore">
          <span className="text-xs text-muted">Ultime 24 ore:</span>
          {summary.length === 0
            ? <span className="text-xs text-muted">nessuna chiamata</span>
            : summary.map(([k, n]) => <StatusBadge key={k} tone={ESITO[k]?.tone ?? 'neutral'}>{ESITO[k]?.label ?? k}: {n}</StatusBadge>)}
        </div>
      </div>
      {error && <p className="px-5 pb-3 text-sm text-danger" role="alert">{error}</p>}
      <div className="overflow-x-auto">
        {data === null ? <SkeletonTable rows={4} cols={6} /> : data.calls.length === 0 ? (
          <EmptyState title="Nessuna chiamata ricevuta" hint="Se iKnow dice di aver chiamato, la richiesta non è arrivata fin qui: controlla indirizzo, porta e rete." />
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted">
              <th className="px-4 py-3">Ricevuta</th><th className="px-4 py-3">Esito</th><th className="px-4 py-3">Commessa</th>
              <th className="px-4 py-3">Seriale</th><th className="px-4 py-3">Fase</th><th className="px-4 py-3">Componente</th><th className="px-4 py-3">Da</th>
            </tr></thead>
            <tbody className="divide-y divide-line">
              {data.calls.map(c => {
                const e = ESITO[c.esito] ?? { label: c.esito, tone: 'neutral' as Tone };
                return (
                  <tr key={c.id}>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted">{fmt(c.received_at)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge tone={e.tone}>{e.label}</StatusBadge>
                      <span className="ml-1 text-xs text-muted">HTTP {c.http_status}</span>
                      {(c.dettaglio || e.hint) && <p className="mt-1 max-w-xs text-xs text-muted">{c.dettaglio ?? e.hint}</p>}
                    </td>
                    <td className="px-4 py-3 font-medium text-ink-900">{c.commessa ?? '—'}</td>
                    <td className="px-4 py-3 text-muted">{c.seriale ?? '—'}</td>
                    <td className="px-4 py-3 text-muted">{c.fase ?? '—'}</td>
                    <td className="px-4 py-3 text-muted">{c.componente ?? '—'}{c.versione ? ` · ${c.versione}` : ''}</td>
                    <td className="px-4 py-3 text-xs text-muted">{c.ip ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

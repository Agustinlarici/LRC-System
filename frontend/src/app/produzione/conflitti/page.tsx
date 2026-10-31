'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import type { ProdComponentConflict, ProdComponentConflictCandidate } from '@/types';

// Per un Forecast, la "Recency" mostrata è il file_mtime grezzo (stessa
// colonna "Data file" di /edi — vedi ediRoutes GET /ingresso/ordini), NON
// fonte_recency: quella ricade su scanned_at quando file_mtime è assente,
// che è identico per migliaia di righe scansionate nello stesso batch e non
// rappresenta una data reale del file.
function fmtRecency(cand: ProdComponentConflictCandidate): string {
  if (cand.fonte_ordine === 'forecast') {
    return cand.edi_file_mtime
      ? new Date(cand.edi_file_mtime).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })
      : '–';
  }
  return cand.fonte_recency ? new Date(cand.fonte_recency).toLocaleDateString('it-IT') : '–';
}

export default function ProduzioneConflittiPage() {
  const [conflicts, setConflicts] = useState<ProdComponentConflict[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [busyKey,   setBusyKey]   = useState<string | null>(null);

  const load = () => {
    // Scansiona tutto prod_order_unified senza filtro data — può richiedere
    // più del timeout di default (15s) su dataset grandi.
    return api.get<ProdComponentConflict[]>('/api/prod/component-conflicts', 60_000)
      .then(setConflicts)
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  async function scegli(c: ProdComponentConflict, codiceArticolo: string) {
    const key = `${c.categoria}|${c.commessa}`;
    setBusyKey(key);
    try {
      await api.put('/api/prod/component-conflicts/override', {
        categoria: c.categoria, commessa: c.commessa, codiceArticolo,
      });
      await load();
    } finally { setBusyKey(null); }
  }

  async function tornaAutomatico(c: ProdComponentConflict) {
    const key = `${c.categoria}|${c.commessa}`;
    setBusyKey(key);
    try {
      await api.delete(`/api/prod/component-conflicts/override?categoria=${encodeURIComponent(c.categoria)}&commessa=${encodeURIComponent(c.commessa)}`);
      await load();
    } finally { setBusyKey(null); }
  }

  // I gruppi con almeno un candidato "stesso giorno" (il caso più probabile
  // di doppione, evidenziato in rosso) vanno in cima — sono quelli da
  // controllare per primi. Sort stabile: a parità, resta l'ordine di prima
  // (commessa/categoria, dal backend).
  const sortedConflicts = useMemo(() => {
    const isRed = (c: ProdComponentConflict) => c.candidates.some(cand => cand.stesso_giorno_altro_codice);
    return [...conflicts].sort((a, b) => Number(isRed(b)) - Number(isRed(a)));
  }, [conflicts]);

  return (
    <div>
      <PageHeader
        back={{ label: 'Programma Produzione', href: '/produzione' }}
        title="Duplicati da verificare"
        description="Più articoli della stessa categoria componente per la stessa commessa: probabile duplicato in Business Central (o forecast EDI) da chiudere o correggere a mano. Il foglio mostra già solo l'articolo in uso. Le righe rosse indicano codici diversi registrati lo stesso giorno: da controllare per primi."
      />

      {loading ? (
        <SkeletonTable rows={4} cols={6} />
      ) : error ? (
        <div className="p-4 bg-danger-soft text-danger rounded-ctl text-sm">{error}</div>
      ) : conflicts.length === 0 ? (
        <div className="bg-white rounded-card shadow-card">
          <EmptyState title="Nessun duplicato trovato" hint="Tutti i componenti hanno un solo articolo per commessa." />
        </div>
      ) : (
        <div className="space-y-4">
          {sortedConflicts.map((c, i) => (
            <div key={i} className="bg-white rounded-card shadow-card overflow-hidden">
              <div className="px-5 py-3 border-b border-line flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-ink-900">{c.categoria}</span>
                  <span className="text-muted">·</span>
                  <span className="font-mono text-ink-700">Commessa {c.commessa}</span>
                  {c.overridden && (
                    <StatusBadge tone="info">Scelta manuale</StatusBadge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {c.overridden && (
                    <Button variant="ghost" onClick={() => tornaAutomatico(c)} disabled={busyKey === `${c.categoria}|${c.commessa}`}
                      className="!px-2 !py-1 !text-xs">
                      Torna automatico
                    </Button>
                  )}
                  <StatusBadge tone="warning">{c.candidates.length} articoli trovati</StatusBadge>
                </div>
              </div>
              <table className="w-full text-sm table-fixed">
                <colgroup>
                  <col className="w-[9%]" />
                  <col className="w-[17%]" />
                  <col className="w-[17%]" />
                  <col className="w-[9%]" />
                  <col className="w-[14%]" />
                  <col className="w-[10%]" />
                  <col className="w-[9%]" />
                  <col className="w-[15%]" />
                </colgroup>
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-muted border-b border-stone-100">
                    <th className="py-2 px-4 text-left font-medium">Codice</th>
                    <th className="py-2 px-4 text-left font-medium">Descrizione</th>
                    <th className="py-2 px-4 text-left font-medium">Descrizione aggiuntiva</th>
                    <th className="py-2 px-4 text-left font-medium">Fonte</th>
                    <th className="py-2 px-4 text-left font-medium">File EDI</th>
                    <th className="py-2 px-4 text-left font-medium">Recency</th>
                    <th className="py-2 px-4 text-center font-medium">In uso</th>
                    <th className="py-2 px-4 text-center font-medium">Scegli</th>
                  </tr>
                </thead>
                <tbody>
                  {c.candidates.map((cand, j) => (
                    <tr
                      key={j}
                      className={`border-b border-stone-100 last:border-0 ${
                        cand.stesso_giorno_altro_codice ? 'bg-danger-soft' : cand.is_winner ? 'bg-success-soft/60' : ''
                      }`}
                      title={cand.stesso_giorno_altro_codice
                        ? 'Un altro codice articolo di questo gruppo ha la stessa data di registrazione/scansione'
                        : undefined}
                    >
                      <td className="py-2 px-4 font-mono truncate" title={cand.codice_articolo}>
                        {cand.codice_articolo}
                        {cand.stesso_giorno_altro_codice && (
                          <span className="ml-1.5 text-danger" title="Stesso giorno di un altro codice articolo">⚠</span>
                        )}
                      </td>
                      <td className="py-2 px-4 text-ink-700 truncate" title={cand.descrizione ?? undefined}>
                        {cand.descrizione ?? '–'}
                      </td>
                      <td className="py-2 px-4 text-ink-700 truncate" title={cand.descrizione_estesa ?? undefined}>
                        {cand.descrizione_estesa ?? '–'}
                      </td>
                      <td className="py-2 px-4">
                        <StatusBadge tone={cand.fonte_ordine === 'confermato' ? 'success' : 'warning'}>
                          {cand.fonte_ordine === 'confermato' ? 'Confermato' : 'Forecast'}
                        </StatusBadge>
                      </td>
                      <td className="py-2 px-4 text-muted truncate" title={cand.edi_source_file ?? undefined}>
                        {cand.edi_source_file ?? <span className="text-stone-300">–</span>}
                      </td>
                      <td className={`py-2 px-4 truncate ${cand.stesso_giorno_altro_codice ? 'text-danger font-medium' : 'text-muted'}`}>
                        {fmtRecency(cand)}
                      </td>
                      <td className="py-2 px-4 text-center">
                        {cand.is_winner ? '✓' : <span className="text-stone-300">—</span>}
                      </td>
                      <td className="py-2 px-4 text-center">
                        {cand.is_winner ? (
                          <span className="text-stone-300">—</span>
                        ) : (
                          <Button
                            onClick={() => scegli(c, cand.codice_articolo)}
                            disabled={busyKey === `${c.categoria}|${c.commessa}`}
                            className="!px-3 !py-1 !text-xs"
                          >
                            Usa questo
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

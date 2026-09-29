'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
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
      <div className="mb-6">
        <Link href="/produzione" className="inline-flex items-center gap-1 text-sm font-medium px-3 py-2 rounded-lg transition-colors bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 mb-3">← Programma Produzione</Link>
        <h1 className="text-3xl font-bold text-gray-900 mt-2">Componenti duplicati da verificare in Dynamics</h1>
        <p className="mt-1 text-gray-500">
          Più di un articolo della stessa categoria componente per la stessa commessa —
          probabile duplicato in Business Central (o forecast EDI) da chiudere/correggere a mano.
          Il foglio di lavoro mostra già solo l&apos;articolo in uso (evidenziato qui sotto).
          Le righe in rosso indicano codici diversi registrati/scansionati lo stesso giorno —
          il caso più probabile di doppione da controllare per primo.
        </p>
      </div>

      {loading ? (
        <p className="text-gray-400">Caricamento...</p>
      ) : error ? (
        <div className="p-4 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
      ) : conflicts.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          Nessun duplicato trovato. 🎉
        </div>
      ) : (
        <div className="space-y-4">
          {sortedConflicts.map((c, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-800">{c.categoria}</span>
                  <span className="text-gray-400">·</span>
                  <span className="font-mono text-gray-600">Commessa {c.commessa}</span>
                  {c.overridden && (
                    <span className="text-xs text-blue-700 bg-blue-100 px-2 py-0.5 rounded font-medium">Scelta manuale</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {c.overridden && (
                    <button onClick={() => tornaAutomatico(c)} disabled={busyKey === `${c.categoria}|${c.commessa}`}
                      className="text-xs text-gray-500 hover:text-gray-700 underline disabled:opacity-50">
                      Torna automatico
                    </button>
                  )}
                  <span className="text-xs text-yellow-700 bg-yellow-100 px-2 py-0.5 rounded font-medium">
                    {c.candidates.length} articoli trovati
                  </span>
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
                  <tr className="text-gray-500 border-b border-gray-100">
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
                      className={`border-b border-gray-50 last:border-0 ${
                        cand.stesso_giorno_altro_codice ? 'bg-red-50' : cand.is_winner ? 'bg-green-50' : ''
                      }`}
                      title={cand.stesso_giorno_altro_codice
                        ? 'Un altro codice articolo di questo gruppo ha la stessa data di registrazione/scansione'
                        : undefined}
                    >
                      <td className="py-2 px-4 font-mono truncate" title={cand.codice_articolo}>
                        {cand.codice_articolo}
                        {cand.stesso_giorno_altro_codice && (
                          <span className="ml-1.5 text-red-600" title="Stesso giorno di un altro codice articolo">⚠</span>
                        )}
                      </td>
                      <td className="py-2 px-4 text-gray-600 truncate" title={cand.descrizione ?? undefined}>
                        {cand.descrizione ?? '–'}
                      </td>
                      <td className="py-2 px-4 text-gray-600 truncate" title={cand.descrizione_estesa ?? undefined}>
                        {cand.descrizione_estesa ?? '–'}
                      </td>
                      <td className="py-2 px-4">
                        <span className={`inline-block text-xs px-2 py-0.5 rounded font-medium ${
                          cand.fonte_ordine === 'confermato' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {cand.fonte_ordine === 'confermato' ? 'Confermato' : 'Forecast'}
                        </span>
                      </td>
                      <td className="py-2 px-4 text-gray-500 truncate" title={cand.edi_source_file ?? undefined}>
                        {cand.edi_source_file ?? <span className="text-gray-300">–</span>}
                      </td>
                      <td className={`py-2 px-4 truncate ${cand.stesso_giorno_altro_codice ? 'text-red-700 font-medium' : 'text-gray-500'}`}>
                        {fmtRecency(cand)}
                      </td>
                      <td className="py-2 px-4 text-center">
                        {cand.is_winner ? '✅' : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-2 px-4 text-center">
                        {cand.is_winner ? (
                          <span className="text-gray-300">—</span>
                        ) : (
                          <button
                            onClick={() => scegli(c, cand.codice_articolo)}
                            disabled={busyKey === `${c.categoria}|${c.commessa}`}
                            className="text-xs text-blue-600 border border-blue-200 px-2 py-1 rounded hover:bg-blue-50 disabled:opacity-50"
                          >
                            Usa questo
                          </button>
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

'use client';

import React, { useEffect, useState } from 'react';
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

  useEffect(() => {
    // Scansiona tutto prod_order_unified senza filtro data — può richiedere
    // più del timeout di default (15s) su dataset grandi.
    api.get<ProdComponentConflict[]>('/api/prod/component-conflicts', 60_000)
      .then(setConflicts)
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="mb-6">
        <Link href="/produzione" className="text-sm text-gray-500 hover:text-gray-700">← Programma Produzione</Link>
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
          {conflicts.map((c, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                <div>
                  <span className="font-semibold text-gray-800">{c.categoria}</span>
                  <span className="text-gray-400 mx-2">·</span>
                  <span className="font-mono text-gray-600">Commessa {c.commessa}</span>
                </div>
                <span className="text-xs text-yellow-700 bg-yellow-100 px-2 py-0.5 rounded font-medium">
                  {c.candidates.length} articoli trovati
                </span>
              </div>
              <table className="w-full text-sm table-fixed">
                <colgroup>
                  <col className="w-[10%]" />
                  <col className="w-[20%]" />
                  <col className="w-[20%]" />
                  <col className="w-[10%]" />
                  <col className="w-[16%]" />
                  <col className="w-[12%]" />
                  <col className="w-[12%]" />
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

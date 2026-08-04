'use client';

import React, { useMemo } from 'react';
import type { ProdSheetRow } from '@/types';

export function SheetTable({ rows }: { rows: ProdSheetRow[] }) {
  const categorieUniche = useMemo(() => {
    const set = new Set<string>();
    rows.forEach(r => r.categorie.forEach(c => set.add(c.categoria)));
    const list = [...set];
    if (list.includes('X.EXTRA')) {
      return [...list.filter(c => c !== 'X.EXTRA'), 'X.EXTRA'];
    }
    return list;
  }, [rows]);

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
        Nessun ordine con data di ingresso in linea trovato.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse operator-sheet">
        <thead>
          <tr className="bg-gray-100">
            <th className="border border-gray-300 px-2 py-1.5">#</th>
            <th className="border border-gray-300 px-2 py-1.5 text-left">Stato</th>
            <th className="border border-gray-300 px-2 py-1.5 text-left">Commessa</th>
            <th className="border border-gray-300 px-2 py-1.5 text-left">Codice</th>
            <th className="border border-gray-300 px-2 py-1.5 text-left whitespace-nowrap">Ingresso Linea</th>
            <th className="border border-gray-300 px-2 py-1.5 text-left">Colore</th>
            {categorieUniche.map(cat => (
              <th key={cat} className={`border border-gray-300 px-2 py-1.5 text-center ${cat === 'X.EXTRA' ? 'font-bold' : ''}`}>
                {cat}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={`${row.codice_articolo}-${row.commessa}`} className="hover:bg-gray-50">
              <td className="border border-gray-200 px-2 py-1 text-center">{idx + 1}</td>
              <td className="border border-gray-200 px-2 py-1">
                <span className={`inline-block text-xs px-2 py-0.5 rounded font-medium whitespace-nowrap ${
                  row.chiuso ? 'bg-gray-200 text-gray-600'
                    : row.fonte_ordine === 'confermato' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                }`}>
                  {row.chiuso ? 'Chiuso' : row.fonte_ordine === 'confermato' ? 'Confermato' : 'Forecast'}
                </span>
              </td>
              <td className="border border-gray-200 px-2 py-1 font-mono">{row.commessa}</td>
              <td className="border border-gray-200 px-2 py-1 font-mono">{row.codice_articolo}</td>
              <td className="border border-gray-200 px-2 py-1 whitespace-nowrap">
                {row.insertion_line_ts ? (
                  <>
                    {new Date(row.insertion_line_ts).toLocaleString('it-IT', {
                      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                    })}
                    {row.insertion_schedulato && (
                      <span
                        className="ml-1 text-amber-600"
                        title="Data da Schedulato — non ancora fisicamente in linea, da controllare"
                      >
                        ⚠
                      </span>
                    )}
                  </>
                ) : '–'}
              </td>
              <td className="border border-gray-200 px-2 py-1">{row.colore ?? <span className="text-gray-300">–</span>}</td>
              {categorieUniche.map(cat => {
                const match = row.categorie.find(c => c.categoria === cat);
                return (
                  <td key={cat} className={`border border-gray-200 px-2 py-1 ${cat === 'X.EXTRA' ? 'max-w-[220px] whitespace-normal' : 'whitespace-nowrap'}`}>
                    {match ? match.caratteristiche.map((c, i) => (
                      <React.Fragment key={c.valore}>
                        {i > 0 && ', '}
                        <span
                          className={c.daAltroComponente ? 'text-amber-600' : undefined}
                          title={c.daAltroComponente ? 'Trovata nella descrizione di un altro componente della stessa commessa' : undefined}
                        >
                          {c.valore}
                        </span>
                      </React.Fragment>
                    )) : <span className="text-gray-300">–</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 10mm; }
          .d-print-none { display: none !important; }
          .operator-sheet { font-size: 8pt; }
        }
      `}</style>
    </div>
  );
}

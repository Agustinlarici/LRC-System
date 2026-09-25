'use client';

import React, { useMemo, useState } from 'react';
import type { ProdSheetRow, ProdSheetCategoria } from '@/types';

// Un'unica riga per commessa: unisce le categorie/caratteristiche di tutti
// gli articoli/componenti della commessa (utile per vedere il quadro completo
// senza scorrere righe separate per ogni componente).
function raggruppaPerCommessa(rows: ProdSheetRow[]): ProdSheetRow[] {
  const gruppi = new Map<string, ProdSheetRow[]>();
  for (const r of rows) {
    const list = gruppi.get(r.commessa) ?? [];
    list.push(r);
    gruppi.set(r.commessa, list);
  }

  return [...gruppi.values()].map(gruppo => {
    const primo = gruppo[0];
    const codici = [...new Set(gruppo.map(r => r.codice_articolo))];
    const colori = [...new Set(gruppo.map(r => r.colore).filter((c): c is string => !!c))];
    const insertionTs = gruppo
      .map(r => r.insertion_line_ts)
      .filter((t): t is string => !!t)
      .sort()[0] ?? null;

    const categorie = new Map<string, Map<string, boolean>>();
    for (const r of gruppo) {
      for (const cat of r.categorie) {
        const valori = categorie.get(cat.categoria) ?? new Map<string, boolean>();
        for (const c of cat.caratteristiche) {
          const esistente = valori.get(c.valore);
          if (esistente === undefined || (esistente === true && !c.daAltroComponente)) {
            valori.set(c.valore, c.daAltroComponente);
          }
        }
        categorie.set(cat.categoria, valori);
      }
    }
    const categorieOut: ProdSheetCategoria[] = [...categorie.entries()].map(([categoria, valori]) => ({
      categoria,
      caratteristiche: [...valori.entries()]
        .map(([valore, daAltroComponente]) => ({ valore, daAltroComponente }))
        .sort((a, b) => a.valore.localeCompare(b.valore)),
    }));
    categorieOut.sort((a, b) => {
      if (a.categoria === 'X.EXTRA') return 1;
      if (b.categoria === 'X.EXTRA') return -1;
      return a.categoria.localeCompare(b.categoria);
    });

    return {
      fonte_ordine:      gruppo.some(r => r.fonte_ordine === 'confermato') ? 'confermato' : 'forecast',
      codice_articolo:   codici.join('\n'),
      commessa:          primo.commessa,
      descrizione:       primo.descrizione,
      ubicazione:        primo.ubicazione,
      insertion_line_ts: insertionTs,
      insertion_schedulato: gruppo.some(r => r.insertion_schedulato),
      chiuso:            gruppo.every(r => r.chiuso),
      colore:            colori.join(', ') || null,
      categorie:         categorieOut,
    };
  });
}

export function SheetTable({ rows }: { rows: ProdSheetRow[] }) {
  const [raggruppa, setRaggruppa] = useState(false);

  const displayRows = useMemo(
    () => raggruppa ? raggruppaPerCommessa(rows) : rows,
    [rows, raggruppa],
  );

  const categorieUniche = useMemo(() => {
    const set = new Set<string>();
    displayRows.forEach(r => r.categorie.forEach(c => set.add(c.categoria)));
    const list = [...set];
    if (list.includes('X.EXTRA')) {
      return [...list.filter(c => c !== 'X.EXTRA'), 'X.EXTRA'];
    }
    return list;
  }, [displayRows]);

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
        Nessun ordine con data di ingresso in linea trovato.
      </div>
    );
  }

  return (
    <div>
      <div className="d-print-none mb-2 flex justify-end">
        <button
          onClick={() => setRaggruppa(g => !g)}
          className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${
            raggruppa ? 'bg-gray-700 text-white hover:bg-gray-800' : 'border border-gray-200 hover:bg-gray-50'
          }`}
        >
          {raggruppa ? '✓ Raggruppato per commessa' : 'Raggruppa per commessa'}
        </button>
      </div>

      <div className="overflow-auto max-h-[75vh] print:max-h-none print:overflow-visible">
        <table className="w-full text-sm border-collapse operator-sheet">
        <thead>
          <tr className="bg-gray-100">
            <th className="sticky top-0 z-10 bg-gray-100 border border-gray-300 px-2 py-1.5">#</th>
            <th className="sticky top-0 z-10 bg-gray-100 border border-gray-300 px-2 py-1.5 text-left">Origine</th>
            <th className="sticky top-0 z-10 bg-gray-100 border border-gray-300 px-2 py-1.5 text-left">Stato</th>
            <th className="sticky top-0 z-10 bg-gray-100 border border-gray-300 px-2 py-1.5 text-left">Commessa</th>
            <th className="sticky top-0 z-10 bg-gray-100 border border-gray-300 px-2 py-1.5 text-left">Codice</th>
            <th className="sticky top-0 z-10 bg-gray-100 border border-gray-300 px-2 py-1.5 text-left whitespace-nowrap">Ingresso Linea</th>
            <th className="sticky top-0 z-10 bg-gray-100 border border-gray-300 px-2 py-1.5 text-left">Colore</th>
            {categorieUniche.map(cat => (
              <th key={cat} className={`sticky top-0 z-10 bg-gray-100 border border-gray-300 px-2 py-1.5 text-center ${cat === 'X.EXTRA' ? 'font-bold' : ''}`}>
                {cat}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {displayRows.map((row, idx) => (
            <tr key={`${row.codice_articolo}-${row.commessa}`} className="hover:bg-gray-50">
              <td className="border border-gray-200 px-2 py-1 text-center">{idx + 1}</td>
              <td className="border border-gray-200 px-2 py-1">
                <span className={`inline-block text-xs px-2 py-0.5 rounded font-medium whitespace-nowrap ${
                  row.fonte_ordine === 'confermato' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                }`}>
                  {row.fonte_ordine === 'confermato' ? 'Confermato' : 'Forecast'}
                </span>
              </td>
              <td className="border border-gray-200 px-2 py-1">
                {row.chiuso ? (
                  <span className="inline-block text-xs px-2 py-0.5 rounded font-medium whitespace-nowrap bg-gray-200 text-gray-600">
                    Spedito
                  </span>
                ) : <span className="text-gray-300">–</span>}
              </td>
              <td className="border border-gray-200 px-2 py-1 font-mono">{row.commessa}</td>
              <td className="border border-gray-200 px-2 py-1 font-mono whitespace-pre-line">{row.codice_articolo}</td>
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
      </div>

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

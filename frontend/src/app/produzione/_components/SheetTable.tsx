'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { compareCategorie } from '@/lib/utils';
import type { ProdSheetRow, ProdSheetCategoria, ProdCategoryOrder } from '@/types';

// Un'unica riga per commessa: unisce le categorie/caratteristiche di tutti
// gli articoli/componenti della commessa (utile per vedere il quadro completo
// senza scorrere righe separate per ogni componente).
function raggruppaPerCommessa(rows: ProdSheetRow[], categoryOrderMap: Map<string, number>): ProdSheetRow[] {
  const gruppi = new Map<string, ProdSheetRow[]>();
  for (const r of rows) {
    const list = gruppi.get(r.commessa) ?? [];
    list.push(r);
    gruppi.set(r.commessa, list);
  }

  return [...gruppi.values()].map(gruppo => {
    const primo = gruppo[0];
    const codici = [...new Set(gruppo.map(r => r.codice_articolo))];
    const descrizioni = codici.map(codice =>
      gruppo.find(r => r.codice_articolo === codice)?.descrizione ?? '',
    );
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
    categorieOut.sort((a, b) => compareCategorie(a.categoria, b.categoria, categoryOrderMap));

    return {
      fonte_ordine:      gruppo.some(r => r.fonte_ordine === 'confermato') ? 'confermato' : 'forecast',
      codice_articolo:   codici.join('\n'),
      commessa:          primo.commessa,
      descrizione:       descrizioni.join('\n'),
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
  const [categoryOrderMap, setCategoryOrderMap] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    api.get<ProdCategoryOrder[]>('/api/prod/category-order')
      .then(list => setCategoryOrderMap(new Map(
        list.filter(c => c.ordine != null).map(c => [c.categoria, c.ordine as number]),
      )))
      .catch(() => {});
  }, []);

  const displayRows = useMemo(
    () => raggruppa ? raggruppaPerCommessa(rows, categoryOrderMap) : rows,
    [rows, raggruppa, categoryOrderMap],
  );

  const categorieUniche = useMemo(() => {
    const set = new Set<string>();
    displayRows.forEach(r => r.categorie.forEach(c => set.add(c.categoria)));
    return [...set].sort((a, b) => compareCategorie(a, b, categoryOrderMap));
  }, [displayRows, categoryOrderMap]);

  async function esportaExcel() {
    const XLSX = await import('xlsx');
    const data = displayRows.map((row, idx) => {
      const out: Record<string, string | number> = {
        '#':             idx + 1,
        Origine:         row.fonte_ordine === 'confermato' ? 'Confermato' : 'Forecast',
        Stato:           row.chiuso ? 'Spedito' : '',
        Commessa:        row.commessa,
        Codice:          row.codice_articolo,
        Descrizione:     row.descrizione ?? '',
        'Ingresso Linea': row.insertion_line_ts
          ? new Date(row.insertion_line_ts).toLocaleString('it-IT', {
              day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
            })
          : '',
        Colore:          row.colore ?? '',
      };
      for (const cat of categorieUniche) {
        const match = row.categorie.find(c => c.categoria === cat);
        out[cat] = match ? match.caratteristiche.map(c => c.valore).join(', ') : '';
      }
      return out;
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Programma Produzione');
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `programma-produzione-${stamp}.xlsx`);
  }

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
        Nessun ordine con data di ingresso in linea trovato.
      </div>
    );
  }

  return (
    <div>
      <div className="d-print-none mb-2 flex justify-end gap-2">
        <button
          onClick={esportaExcel}
          className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
        >
          📥 Scarica Excel
        </button>
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
        <table className="w-full text-sm border-separate border-spacing-0 operator-sheet">
        <thead>
          <tr className="bg-gray-100">
            <th className="sticky top-0 z-10 bg-gray-100 border border-gray-300 px-2 py-1.5">#</th>
            <th className="sticky top-0 z-10 bg-gray-100 border border-gray-300 px-2 py-1.5 text-left">Origine</th>
            <th className="sticky top-0 z-10 bg-gray-100 border border-gray-300 px-2 py-1.5 text-left">Stato</th>
            <th className="sticky top-0 z-10 bg-gray-100 border border-gray-300 px-2 py-1.5 text-left">Commessa</th>
            <th className="sticky top-0 z-10 bg-gray-100 border border-gray-300 px-2 py-1.5 text-left">Codice</th>
            <th className="sticky top-0 z-10 bg-gray-100 border border-gray-300 px-2 py-1.5 text-left">Descrizione</th>
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
            <tr key={`${row.codice_articolo}-${row.commessa}`} className="bg-white hover:bg-gray-50">
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
              <td className="border border-gray-200 px-2 py-1 min-w-[180px] max-w-[260px] whitespace-pre-line break-words" title={row.descrizione ?? ''}>
                {row.descrizione ?? <span className="text-gray-300">–</span>}
              </td>
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

import { StatusBadge } from '@/components/ui/StatusBadge';

export interface Riga {
  line_no: number; article_code: string; quantity: number; order_no: string; descrizione: string;
  prezzo_str: number; totale_riga: number; regole: { id: number; nome: string; prezzo: number }[];
}
export interface Dettaglio { shipment_id: string; shipment_date: string | null; customer_account: string; righe: Riga[]; totale_str: number }

export const eur = (n: number) => n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });

const SENZA_NOME = '(senza nome)';
const nomeRegola = (n: string) => n.trim() || SENZA_NOME;
/** Colonne del dettaglio: i nomi delle regole applicate nelle righe del despacho, nell'ordine in cui compaiono. */
const colonneDi = (righe: Riga[]): string[] => {
  const out: string[] = [];
  for (const l of righe) for (const g of l.regole) { const n = nomeRegola(g.nome); if (!out.includes(n)) out.push(n); }
  return out;
};
/** Valore unitario di una colonna per una riga (più regole con lo stesso nome si sommano); null = non applicata. */
const valoreDi = (l: Riga, col: string): number | null => {
  const v = l.regole.filter(g => nomeRegola(g.nome) === col);
  return v.length === 0 ? null : Math.round(v.reduce((a, g) => a + g.prezzo, 0) * 100) / 100;
};


/** Tabella delle righe di un despacho: spedizione, codice, descrizione, una colonna per regola applicata, totali. */
export function TabellaDespacho({ det, righe }: { det: Dettaglio; righe: Riga[] }) {
    const totale = Math.round(righe.reduce((a, l) => a + l.totale_riga, 0) * 100) / 100;
    const cols = colonneDi(righe);
    const somma = (c: string) => Math.round(righe.reduce((a, l) => a + (valoreDi(l, c) ?? 0) * l.quantity, 0) * 100) / 100;
    return (
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted">
            <th className="py-1 pr-3 font-medium">Spedizione</th><th className="pr-3 font-medium">Codice</th>
            <th className="pr-3 font-medium">Descrizione ordine</th><th className="pr-3 text-right font-medium">Q.tà</th>
            {cols.map(c => <th key={c} className="pr-3 text-right font-medium text-ink-900">{c}</th>)}
            <th className="pr-3 text-right font-medium">Unitario</th><th className="text-right font-medium">Totale</th>
          </tr>
        </thead>
        <tbody>
          {righe.map(l => (
            <tr key={l.line_no} className="border-t border-line align-top">
              <td className="py-1.5 pr-3 font-mono text-muted">{det.shipment_id}</td>
              <td className="pr-3 font-mono">{l.article_code}</td>
              <td className="pr-3">{l.descrizione || <span className="text-muted">vuota</span>}</td>
              <td className="pr-3 text-right">{l.quantity}</td>
              {l.regole.length === 0
                ? <td colSpan={Math.max(cols.length, 1)} className="pr-3 text-right"><StatusBadge tone="warning">Nessuna regola</StatusBadge></td>
                : cols.map(c => { const v = valoreDi(l, c); return <td key={c} className="pr-3 text-right">{v == null ? <span className="text-stone-300">–</span> : eur(v)}</td>; })}
              <td className="pr-3 text-right">{eur(l.prezzo_str)}</td>
              <td className="text-right font-semibold">{eur(l.totale_riga)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-line font-semibold text-ink-900">
            <td className="py-1.5 pr-3" colSpan={4}>Totale (valore × quantità)</td>
            {cols.map(c => <td key={c} className="pr-3 text-right">{eur(somma(c))}</td>)}
            <td className="pr-3" />
            <td className="text-right">{eur(totale)}</td>
          </tr>
        </tfoot>
      </table>
    );
}

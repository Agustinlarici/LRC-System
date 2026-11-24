// Elenco CHIUSO delle richieste che la PC IA può fare alla VM. Ogni voce: codice -> schema dei parametri (zod, strict) + funzione
// di sola lettura. La PC IA manda solo il codice e i parametri: il testo SQL vive qui, sempre con parametri (mai concatenazioni).
// Per aggiungere un dato: una nuova voce in IA_QUERIES (+ lo stesso codice nel catalogo «Dati» della PC IA) e un test.
import sql from 'mssql';
import { z } from 'zod';
import { getDynamicsConfig } from '../edi/dynamics-client.js';
import { getRigheDespachi } from '../fatturazione/bc.js';

export type Cella = string | number | boolean | null;
export interface RisultatoIa {
  colonne: string[];
  righe: Cella[][];
}
export interface QueryIa {
  descrizione: string;
  parametri: z.ZodType<Record<string, string | number>>;
  esegui: (p: Record<string, string | number>) => Promise<RisultatoIa>;
}

const TABELLA_RIGA_ORDINE = 'STR$Sales Line$437dbf0e-84ff-417a-965d-ed2bb9650972';
const TABELLA_RIGA_ORDINE_EXT = 'STR$Sales Line$437dbf0e-84ff-417a-965d-ed2bb9650972$ext';
const COLONNA_LSA = 'LSA Description Extension$34bccc94-c43f-4899-8aa8-c820f9e64421';
const DOC_TIPO_ORDINE = 1;
const CODICE = z.string().trim().min(1).max(50);

export const IA_QUERIES: Record<string, QueryIa> = {
  // Righe di una spedizione (riusa la lettura già usata dalla fatturazione).
  righe_spedizione: {
    descrizione: 'Righe di una spedizione di Business Central',
    parametri: z.object({ spedizione: CODICE }).strict(),
    esegui: async (p) => {
      const righe = await getRigheDespachi([String(p.spedizione)]);
      return {
        colonne: ['spedizione', 'riga', 'articolo', 'quantita', 'ordine', 'descrizione'],
        righe: righe.map(r => [r.shipment_id, r.line_no, r.article_code, r.quantity, r.order_no, r.descrizione]),
      };
    },
  },
  // Righe di un ordine di vendita: DUE tabelle (riga ordine + estensione LSA). Nomi di colonna non ancora verificati sul database reale.
  righe_ordine_vendita: {
    descrizione: 'Righe di un ordine di vendita (riga + estensione LSA)',
    parametri: z.object({ ordine: CODICE }).strict(),
    esegui: async (p) => {
      const pool = await sql.connect(getDynamicsConfig());
      try {
        const req = pool.request();
        req.input('ordine', sql.VarChar(50), String(p.ordine));
        const res = await req.query(`
          SELECT TOP 200 sl.[Document No_] AS ordine, sl.[Line No_] AS riga, sl.[No_] AS articolo,
                 sl.[Quantity (Base)] AS quantita,
                 LTRIM(RTRIM(ISNULL(ext.[${COLONNA_LSA}], ''))) AS descrizione
          FROM [${TABELLA_RIGA_ORDINE}] sl
          LEFT JOIN [${TABELLA_RIGA_ORDINE_EXT}] ext
            ON ext.[Document Type] = sl.[Document Type] AND ext.[Document No_] = sl.[Document No_] AND ext.[Line No_] = sl.[Line No_]
          WHERE sl.[Document Type] = ${DOC_TIPO_ORDINE} AND sl.[Document No_] = @ordine
          ORDER BY sl.[Line No_]
        `);
        const rows = res.recordset as Array<Record<string, unknown>>;
        return {
          colonne: ['ordine', 'riga', 'articolo', 'quantita', 'descrizione'],
          righe: rows.map(r => [String(r.ordine ?? '').trim(), Number(r.riga ?? 0), String(r.articolo ?? '').trim(), Number(r.quantita ?? 0), String(r.descrizione ?? '').trim()]),
        };
      } finally {
        await pool.close();
      }
    },
  },
};

// Elenco CHIUSO delle richieste che la PC IA può fare alla VM. Ogni voce: codice -> schema dei parametri (zod, strict) + funzione
// di sola lettura. La PC IA manda solo il codice e i parametri: il testo SQL vive qui, sempre con parametri (mai concatenazioni).
// Per aggiungere un dato: una nuova voce in IA_QUERIES (+ lo stesso codice nel catalogo «Dati» della PC IA) e un test.
import sql from 'mssql';
import { z } from 'zod';
import { getDynamicsConfig } from '../edi/dynamics-client.js';
import { getRigheDespachi } from '../fatturazione/bc.js';
import { db } from '../../db/client.js';
import { ParametriWt, eseguiWt } from './wt-builder.js';

export type Cella = string | number | boolean | null;
export interface RisultatoIa {
  colonne: string[];
  righe: Cella[][];
}
export interface QueryIa {
  descrizione: string;
  parametri: z.ZodType<Record<string, string | number | undefined>>;
  esegui: (p: Record<string, string | number | undefined>) => Promise<RisultatoIa>;
}

const TABELLA_RIGA_ORDINE = 'STR$Sales Line$437dbf0e-84ff-417a-965d-ed2bb9650972';
const TABELLA_RIGA_ORDINE_EXT = 'STR$Sales Line$437dbf0e-84ff-417a-965d-ed2bb9650972$ext';
const COLONNA_LSA = 'LSA Description Extension$34bccc94-c43f-4899-8aa8-c820f9e64421';
const DOC_TIPO_ORDINE = 1;
const CODICE = z.string().trim().min(1).max(50);
const DATA_ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

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

  // ---- Storico WebThron: legge la COPIA in PostgreSQL (webthron_events_history), mai WebThron direttamente (MyISAM fragile). ----
  // Costruttore generico (vedi wt-builder.ts): filtri opzionali + raggruppamento; risponde con conteggi e date, non con migliaia di righe.
  wt_events: {
    descrizione: 'Riepilogo eventi WebThron: filtri opzionali (commessa, componente, modello, fase, seriale, esito, dal/al) e raggruppamento (fase, componente, modello, commessa, esito, seriale, data)',
    parametri: ParametriWt,
    esegui: (p) => eseguiWt(ParametriWt.parse(p)),
  },
  wt_events_commessa: {
    descrizione: 'Ultimi eventi WebThron di una commessa (fase, componente, seriale, esito, data), dal più recente',
    parametri: z.object({ commessa: CODICE }).strict(),
    esegui: async (p) => {
      const rows = await db`
        SELECT fase, componente, cod_seriale, esito_delibera, data_inserimento
        FROM webthron_events_history
        WHERE commessa = ${String(p.commessa)}
        ORDER BY data_inserimento DESC
        LIMIT 200`;
      return {
        colonne: ['fase', 'componente', 'seriale', 'esito', 'data'],
        righe: rows.map(r => [String(r.fase), String(r.componente), String(r.cod_seriale), r.esito_delibera == null ? null : String(r.esito_delibera), new Date(r.data_inserimento as string).toISOString()]),
      };
    },
  },
  wt_serial_history: {
    descrizione: 'Storico WebThron di un seriale (tutte le fasi, in ordine di tempo)',
    parametri: z.object({ seriale: CODICE }).strict(),
    esegui: async (p) => {
      const rows = await db`
        SELECT fase, modello, componente, commessa, esito_delibera, data_inserimento
        FROM webthron_events_history
        WHERE cod_seriale = ${String(p.seriale)}
        ORDER BY data_inserimento ASC
        LIMIT 200`;
      return {
        colonne: ['fase', 'modello', 'componente', 'commessa', 'esito', 'data'],
        righe: rows.map(r => [String(r.fase), String(r.modello), String(r.componente), r.commessa == null ? null : String(r.commessa), r.esito_delibera == null ? null : String(r.esito_delibera), new Date(r.data_inserimento as string).toISOString()]),
      };
    },
  },
  wt_daily_counts: {
    descrizione: 'Eventi WebThron di un giorno, raggruppati per fase ed esito (conteggi)',
    parametri: z.object({ data: DATA_ISO }).strict(),
    esegui: async (p) => {
      const rows = await db`
        SELECT fase, COALESCE(esito_delibera, '') AS esito, COUNT(*)::int AS n
        FROM webthron_events_history
        WHERE data_cache = ${String(p.data)}::date
        GROUP BY fase, COALESCE(esito_delibera, '')
        ORDER BY fase, esito
        LIMIT 200`;
      return { colonne: ['fase', 'esito', 'eventi'], righe: rows.map(r => [String(r.fase), String(r.esito), Number(r.n)]) };
    },
  },
};

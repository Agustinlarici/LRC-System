// Costruttore di richieste sullo storico WebThron (webthron_events_history, copia in PostgreSQL).
// Il modello NON scrive SQL: compila una scheda (filtri + raggruppamenti da elenchi chiusi) e qui la si convalida e la si traduce in una
// query parametrizzata di sola lettura. Protezioni per non bloccare PostgreSQL: transazione READ ONLY, statement_timeout breve,
// al massimo 2 richieste IA contemporanee, filtro selettivo obbligatorio, intervallo di date limitato, 200 righe al massimo.
import { z } from 'zod';
import { db } from '../../db/client.js';
import type { RisultatoIa } from './queries.js';

// nome esposto alla PC IA -> colonna reale
export const COLONNE_GRUPPO = {
  fase: 'fase', componente: 'componente', modello: 'modello', commessa: 'commessa',
  esito: 'esito_delibera', seriale: 'cod_seriale', data: 'data_cache',
} as const;
type NomeGruppo = keyof typeof COLONNE_GRUPPO;
const FILTRI: Array<[string, string]> = [
  ['commessa', 'commessa'], ['componente', 'componente'], ['modello', 'modello'],
  ['fase', 'fase'], ['seriale', 'cod_seriale'], ['esito', 'esito_delibera'],
];
const MAX_GIORNI = 92;
const GIORNI_PREDEFINITI = 7;   // senza commessa/seriale/date: ultimi 7 giorni (indice su data_cache)
const MAX_CONTEMPORANEE = 2;
const STATEMENT_TIMEOUT_MS = 5000;
const MAX_RIGHE = 200;

const TESTO = z.string().trim().min(1).max(100);
const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const giorni = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000);

export const ParametriWt = z.object({
  commessa: TESTO.optional(), componente: TESTO.optional(), modello: TESTO.optional(),
  fase: TESTO.optional(), seriale: TESTO.optional(), esito: TESTO.optional(),
  dal: DATA.optional(), al: DATA.optional(),
  raggruppa: z.string().trim().max(60).optional(),
}).strict().superRefine((p, ctx) => {
  const err = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (!!p.dal !== !!p.al) return err('dal e al vanno indicati insieme');
  if (p.dal && p.al) {
    const g = giorni(p.dal, p.al);
    if (Number.isNaN(g) || g < 0) return err('intervallo di date non valido');
    if (g > MAX_GIORNI) return err(`intervallo troppo lungo (massimo ${MAX_GIORNI} giorni)`);
  }
  if (!FILTRI.some(([nome]) => (p as Record<string, string | undefined>)[nome]) && !(p.dal && p.al)) return err('serve almeno un filtro (commessa, seriale, fase, componente, modello, esito) oppure dal/al');
  if (p.raggruppa) {
    const g = p.raggruppa.split(',').map(s => s.trim());
    if (g.length > 3 || new Set(g).size !== g.length || g.some(x => !Object.prototype.hasOwnProperty.call(COLONNE_GRUPPO, x))) {
      return err('raggruppa: fino a 3 valori distinti tra ' + Object.keys(COLONNE_GRUPPO).join(', '));
    }
  }
});
export type ParametriWt = z.infer<typeof ParametriWt>;

export interface PianoWt {
  filtri: Array<{ colonna: string; valore: string }>;
  dal?: string; al?: string;
  gruppi: Array<{ nome: NomeGruppo; colonna: string }>;
}

// Funzione pura (testabile senza database): dai parametri già convalidati al piano.
const oggiRoma = (spostaGiorni = 0) => new Date(Date.now() + spostaGiorni * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });

export function pianoWt(p: ParametriWt): PianoWt {
  const filtri = FILTRI.flatMap(([nome, colonna]) => {
    const v = (p as Record<string, string | undefined>)[nome];
    return v ? [{ colonna, valore: v }] : [];
  });
  const gruppi = (p.raggruppa ? p.raggruppa.split(',').map(s => s.trim()) : [])
    .map(n => ({ nome: n as NomeGruppo, colonna: COLONNE_GRUPPO[n as NomeGruppo] }));
  // senza chiave precisa né date: solo gli ultimi giorni, così la lettura usa l'indice e non scorre tutto lo storico
  const conIntervallo = !!(p.dal && p.al);
  const precisa = !!(p.commessa || p.seriale);
  const dal = conIntervallo ? p.dal : precisa ? undefined : oggiRoma(-(GIORNI_PREDEFINITI - 1));
  const al = conIntervallo ? p.al : precisa ? undefined : oggiRoma();
  return { filtri, dal, al, gruppi };
}

let inCorso = 0;
export const ContemporaneeOccupate = () => inCorso >= MAX_CONTEMPORANEE;

export async function eseguiWt(p: ParametriWt): Promise<RisultatoIa> {
  const piano = pianoWt(p);
  if (inCorso >= MAX_CONTEMPORANEE) throw new Error('troppe richieste IA contemporanee');
  inCorso++;
  try {
    const righe = await db.begin('read only', async (tx) => {
      // set_config(..., true) vale solo per questa transazione (SET non accetta parametri)
      await tx`SELECT set_config('statement_timeout', ${String(STATEMENT_TIMEOUT_MS)}, true),
                      set_config('lock_timeout', '1000', true),
                      set_config('idle_in_transaction_session_timeout', '8000', true)`;
      let cond = tx`TRUE`;
      for (const f of piano.filtri) cond = tx`${cond} AND ${tx(f.colonna)} = ${f.valore}`;
      if (piano.dal && piano.al) cond = tx`${cond} AND data_cache BETWEEN ${piano.dal}::date AND ${piano.al}::date`;
      if (!piano.gruppi.length) {
        return tx`
          SELECT COUNT(*)::int AS eventi, COUNT(DISTINCT cod_seriale)::int AS seriali,
                 MIN(data_inserimento) AS primo, MAX(data_inserimento) AS ultimo
          FROM webthron_events_history WHERE ${cond}`;
      }
      const cols = piano.gruppi.map(g => g.colonna);
      return tx`
        SELECT ${tx(cols)}, COUNT(*)::int AS eventi, COUNT(DISTINCT cod_seriale)::int AS seriali,
               MIN(data_inserimento) AS primo, MAX(data_inserimento) AS ultimo
        FROM webthron_events_history WHERE ${cond}
        GROUP BY ${tx(cols)}
        ORDER BY MAX(data_inserimento) DESC
        LIMIT ${MAX_RIGHE}`;
    });
    const cell = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : typeof v === 'number' ? v : String(v));
    return {
      colonne: [...piano.gruppi.map(g => g.nome), 'eventi', 'seriali', 'primo', 'ultimo'],
      righe: (righe as unknown as Array<Record<string, unknown>>).map(r =>
        [...piano.gruppi.map(g => cell(r[g.colonna])), cell(r.eventi), cell(r.seriali), cell(r.primo), cell(r.ultimo)] as Array<string | number | null>),
    };
  } finally {
    inCorso--;
  }
}

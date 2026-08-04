import { db } from '../../db/client.js';
import type { ProdSheetRow } from './types.js';

interface UnifiedOrderRow {
  fonte_ordine:      'confermato' | 'forecast';
  codice_articolo:   string;
  commessa:          string;
  descrizione:       string | null;
  ubicazione:        string | null;
  insertion_line_ts: string | null;
  insertion_schedulato: boolean;
  colore:            string | null;
  fonte_recency:     string | null;
  // TRUE per un ordine Confermato chiuso in BC (present_now = FALSE) — non
  // sparisce più dal foglio, resta come storico. Non compete mai per una
  // categoria componente (vedi groupByCategoriaCommessa): un ordine chiuso
  // non deve mai "vincere" su uno ancora attivo, né viceversa nasconderlo.
  chiuso:            boolean;
}

interface ManualInfoRow {
  codice_articolo:         string;
  categoria:               string | null;
  caratteristiche_manuali: string | null;
}

interface AutoCharRow {
  codice_articolo: string;
  commessa:        string;
  categoria:       string;
  caratteristica:  string;
}

interface AttrRow {
  codice_articolo:   string;
  item_attribute_id: number;
  value:             string | null;
  categoria_label:   string;
}

export interface FoglioPage {
  rows:  ProdSheetRow[];
  total: number;
}

// ─── Dedup di base: un solo articolo per (codice_articolo, commessa) ──────────

function dedupByArticoloCommessa(rows: UnifiedOrderRow[]): UnifiedOrderRow[] {
  const map = new Map<string, UnifiedOrderRow>();
  for (const r of rows) {
    const k = JSON.stringify([r.codice_articolo, r.commessa]);
    const existing = map.get(k);
    // Se esistono sia una riga attiva che una chiusa per la stessa coppia
    // (raro: la stessa commessa+articolo è stata riaperta come nuovo ordine),
    // vince quella attiva — quella chiusa è solo storico.
    if (!existing || (existing.chiuso && !r.chiuso)) map.set(k, r);
  }
  return [...map.values()];
}

// ─── Categoria componente per articolo (rimpiazzo "vince l'ultimo") ───────────
// Quando più articoli della stessa categoria (es. "PARAURTI") arrivano per
// la stessa commessa, se ne tiene uno solo: Confermato batte Forecast; a
// parità di fonte vince il più recente (fonte_recency: data di registrazione
// BC, o data/scan del file EDI).

async function loadCategoryMap(codes: string[]): Promise<Map<string, string>> {
  if (codes.length === 0) return new Map();
  const rows = await db<{ codice_articolo: string; categoria: string }[]>`
    SELECT codice_articolo, categoria FROM prod_article_component_category
    WHERE codice_articolo = ANY(${codes}) AND categoria IS NOT NULL
  `;
  return new Map(rows.map(r => [r.codice_articolo, r.categoria]));
}

interface CategoriaCommessaGroup {
  categoria: string;
  commessa:  string;
  rows:      UnifiedOrderRow[];
}

// Categoria e commessa restano campi espliciti nel value (mai un parsing
// all'indietro dalla chiave), così non importa se una delle due contiene
// spazi o altri caratteri particolari.
function groupByCategoriaCommessa(rows: UnifiedOrderRow[], categoryMap: Map<string, string>) {
  const grouped = new Map<string, CategoriaCommessaGroup>();
  const unmapped: UnifiedOrderRow[] = [];
  for (const r of rows) {
    // Un ordine chiuso è storico, non un duplicato da risolvere — non
    // compete mai per una categoria componente (passa sempre diretto).
    const categoria = r.chiuso ? undefined : categoryMap.get(r.codice_articolo);
    if (!categoria) { unmapped.push(r); continue; }
    const key = JSON.stringify([categoria, r.commessa]);
    const group = grouped.get(key) ?? { categoria, commessa: r.commessa, rows: [] };
    group.rows.push(r);
    grouped.set(key, group);
  }
  return { grouped, unmapped };
}

function pickWinner(rows: UnifiedOrderRow[]): UnifiedOrderRow {
  let best = rows[0];
  for (const r of rows.slice(1)) {
    if (r.fonte_ordine === 'confermato' && best.fonte_ordine === 'forecast') { best = r; continue; }
    if (r.fonte_ordine === 'forecast' && best.fonte_ordine === 'confermato') continue;
    const rTime    = r.fonte_recency    ? new Date(r.fonte_recency).getTime()    : -Infinity;
    const bestTime = best.fonte_recency ? new Date(best.fonte_recency).getTime() : -Infinity;
    if (rTime > bestTime) best = r;
  }
  return best;
}

async function applyComponentCategoryReplacement(rows: UnifiedOrderRow[]): Promise<UnifiedOrderRow[]> {
  const codes = [...new Set(rows.map(r => r.codice_articolo))];
  const categoryMap = await loadCategoryMap(codes);
  if (categoryMap.size === 0) return rows;

  const { grouped, unmapped } = groupByCategoriaCommessa(rows, categoryMap);
  const winners = [...grouped.values()].map(g => pickWinner(g.rows));
  return [...unmapped, ...winners];
}

function sortByInsertionTs(rows: UnifiedOrderRow[]): UnifiedOrderRow[] {
  return [...rows].sort((a, b) => {
    const at = a.insertion_line_ts ? new Date(a.insertion_line_ts).getTime() : Infinity;
    const bt = b.insertion_line_ts ? new Date(b.insertion_line_ts).getTime() : Infinity;
    return at - bt;
  });
}

// ─── Query base condivisa ──────────────────────────────────────────────────────

// Ordini Confermato chiusi in BC (present_now = FALSE) — non spariscono più
// dal foglio quando l'ordine viene evaso/spedito, restano come storico
// (vedi groupByCategoriaCommessa/dedupByArticoloCommessa: non competono mai
// con un ordine ancora attivo). Nessun limite di tempo: cresce nel tempo,
// ma resta paginato come il resto del foglio.
async function queryClosedOrders(articleCodes: string[] | null): Promise<UnifiedOrderRow[]> {
  return articleCodes != null
    ? db<UnifiedOrderRow[]>`
        SELECT
          'confermato'::VARCHAR(12) AS fonte_ordine,
          po.codice_articolo,
          po.commessa,
          po.description AS descrizione,
          po.ubicazione,
          ci.insertion_line_ts::text AS insertion_line_ts,
          COALESCE(ci.schedulato, FALSE) AS insertion_schedulato,
          col.colore,
          po.data_registrazione::text AS fonte_recency,
          TRUE AS chiuso
        FROM prod_order po
        LEFT JOIN prod_commessa_inserimenti ci ON ci.commessa = po.commessa
        LEFT JOIN prod_article_color col
          ON col.codice_articolo = po.codice_articolo AND col.commessa = po.commessa
        WHERE po.present_now = FALSE AND po.codice_articolo = ANY(${articleCodes})
      `
    : db<UnifiedOrderRow[]>`
        SELECT
          'confermato'::VARCHAR(12) AS fonte_ordine,
          po.codice_articolo,
          po.commessa,
          po.description AS descrizione,
          po.ubicazione,
          ci.insertion_line_ts::text AS insertion_line_ts,
          COALESCE(ci.schedulato, FALSE) AS insertion_schedulato,
          col.colore,
          po.data_registrazione::text AS fonte_recency,
          TRUE AS chiuso
        FROM prod_order po
        LEFT JOIN prod_commessa_inserimenti ci ON ci.commessa = po.commessa
        LEFT JOIN prod_article_color col
          ON col.codice_articolo = po.codice_articolo AND col.commessa = po.commessa
        WHERE po.present_now = FALSE
      `;
}

async function queryUnifiedOrders(articleCodes: string[] | null): Promise<UnifiedOrderRow[]> {
  const [active, closed] = await Promise.all([
    articleCodes != null
      ? db<UnifiedOrderRow[]>`
          SELECT
            u.fonte_ordine,
            u.codice_articolo,
            u.commessa,
            u.descrizione,
            u.ubicazione,
            ci.insertion_line_ts::text AS insertion_line_ts,
            COALESCE(ci.schedulato, FALSE) AS insertion_schedulato,
            col.colore,
            u.fonte_recency::text AS fonte_recency,
            FALSE AS chiuso
          FROM prod_order_unified u
          LEFT JOIN prod_commessa_inserimenti ci ON ci.commessa = u.commessa
          LEFT JOIN prod_article_color col
            ON col.codice_articolo = u.codice_articolo AND col.commessa = u.commessa
          WHERE u.codice_articolo = ANY(${articleCodes})
        `
      : db<UnifiedOrderRow[]>`
          SELECT
            u.fonte_ordine,
            u.codice_articolo,
            u.commessa,
            u.descrizione,
            u.ubicazione,
            ci.insertion_line_ts::text AS insertion_line_ts,
            COALESCE(ci.schedulato, FALSE) AS insertion_schedulato,
            col.colore,
            u.fonte_recency::text AS fonte_recency,
            FALSE AS chiuso
          FROM prod_order_unified u
          LEFT JOIN prod_commessa_inserimenti ci ON ci.commessa = u.commessa
          LEFT JOIN prod_article_color col
            ON col.codice_articolo = u.codice_articolo AND col.commessa = u.commessa
        `,
    queryClosedOrders(articleCodes),
  ]);
  return [...active, ...closed];
}

/**
 * Costruisce il foglio di lavoro (righe con caratteristiche unite: manuali +
 * automatiche da parole chiave + attributi BC). Se `articleCodes` è null,
 * non filtra per articolo — mostra tutto, con o senza area di montaggio.
 *
 * Confermato e Forecast compaiono SEMPRE (con o senza data di ingresso in
 * linea) e la data — quando esiste — viene dalla stessa
 * prod_commessa_inserimenti popolata dall'import SPMA per entrambe le fonti:
 * una commessa già pianificata mostra la data anche se l'ordine è ancora
 * Forecast in BC. Senza data va in fondo alla lista (vedi sortByInsertionTs).
 * Prima un Confermato senza data veniva nascosto, il che lo faceva sparire
 * del tutto se esisteva anche un Forecast per la stessa coppia (l'anti-join
 * della vista prod_order_unified scarta il Forecast non appena un Confermato
 * present_now esiste, indipendentemente dalla data).
 *
 * Rimpiazzo per categoria componente: se due articoli mappati alla stessa
 * categoria (es. "PARAURTI") arrivano per la stessa commessa, se ne tiene
 * uno solo (vedi applyComponentCategoryReplacement). Gli scartati compaiono
 * invece in findComponentConflicts(), per essere risolti in Dynamics.
 *
 * Paginato: senza filtro articolo si può arrivare a 20k+ righe (7+ MB di
 * JSON) — il browser si pianta a renderizzare una tabella così, a prescindere
 * da quanto sia veloce la query. `limit`/`offset` tagliano DOPO l'ordinamento
 * (così la pagina è stabile) ma PRIMA delle query di caratteristiche (così si
 * calcolano solo per le righe richieste, non per tutte).
 */
export async function buildFoglio(
  articleCodes: string[] | null,
  page: { limit?: number; offset?: number } = {},
): Promise<FoglioPage> {
  if (articleCodes != null && articleCodes.length === 0) return { rows: [], total: 0 };

  const orderRows = await queryUnifiedOrders(articleCodes);
  const deduped  = dedupByArticoloCommessa(orderRows);
  const replaced = await applyComponentCategoryReplacement(deduped);
  const sorted   = sortByInsertionTs(replaced);

  const total = sorted.length;
  if (total === 0) return { rows: [], total: 0 };

  const { limit, offset = 0 } = page;
  const pageRows = limit != null ? sorted.slice(offset, offset + limit) : sorted;
  if (pageRows.length === 0) return { rows: [], total };

  const codes    = [...new Set(pageRows.map(r => r.codice_articolo))];
  const commesse = [...new Set(pageRows.map(r => r.commessa))];

  const [manualRows, autoRows, attrRows] = await Promise.all([
    db<ManualInfoRow[]>`
      SELECT codice_articolo, categoria, caratteristiche_manuali
      FROM prod_article_info
      WHERE codice_articolo = ANY(${codes})
    `,
    // Niente filtro per codice_articolo: servono TUTTI gli articoli di queste
    // commesse, non solo quelli di questa pagina — per poter mostrare anche
    // le caratteristiche trovate nella descrizione di ALTRI componenti della
    // stessa commessa (es. la livrea trovata nel parabrezza, utile anche per
    // chi monta il paraurti).
    db<AutoCharRow[]>`
      SELECT codice_articolo, commessa, categoria, caratteristica
      FROM prod_article_auto
      WHERE commessa = ANY(${commesse})
    `,
    db<AttrRow[]>`
      SELECT pia.codice_articolo, pia.item_attribute_id, pia.value,
             COALESCE(pial.categoria_label, 'Attributo #' || pia.item_attribute_id) AS categoria_label
      FROM prod_item_attribute pia
      LEFT JOIN prod_item_attribute_label pial ON pial.item_attribute_id = pia.item_attribute_id
      WHERE pia.codice_articolo = ANY(${codes})
        AND (pial.active IS NULL OR pial.active = TRUE)
        AND pia.value IS NOT NULL
    `,
  ]);

  // Pre-indicizzati per codice_articolo (e codice_articolo+commessa per le
  // automatiche) — con migliaia di righe lato tabella, uno scan lineare
  // dentro il .map() principale è O(righe × tabella) e diventa lentissimo
  // (20k righe × 2.6k attributi = 54M confronti misurati a ~9s).
  const manualByArticolo = new Map<string, ManualInfoRow[]>();
  for (const m of manualRows) {
    const list = manualByArticolo.get(m.codice_articolo) ?? [];
    list.push(m);
    manualByArticolo.set(m.codice_articolo, list);
  }
  // autoByKey: caratteristiche PROPRIE dell'articolo (per la riga esatta).
  // autoByCommessa: TUTTE le caratteristiche della commessa, di qualunque
  // articolo — usata solo per trovare quelle "di un altro componente".
  const autoByKey = new Map<string, AutoCharRow[]>();
  const autoByCommessa = new Map<string, AutoCharRow[]>();
  for (const a of autoRows) {
    const key = JSON.stringify([a.codice_articolo, a.commessa]);
    const listKey = autoByKey.get(key) ?? [];
    listKey.push(a);
    autoByKey.set(key, listKey);

    const listCommessa = autoByCommessa.get(a.commessa) ?? [];
    listCommessa.push(a);
    autoByCommessa.set(a.commessa, listCommessa);
  }
  const attrByArticolo = new Map<string, AttrRow[]>();
  for (const attr of attrRows) {
    const list = attrByArticolo.get(attr.codice_articolo) ?? [];
    list.push(attr);
    attrByArticolo.set(attr.codice_articolo, list);
  }

  const rows = pageRows.map(r => {
    // categoria → valore → è "di un altro componente"? (false vince sempre
    // su true: se il valore è anche proprio, non va marcato come esterno)
    const categorie = new Map<string, Map<string, boolean>>();
    const addChar = (categoria: string, valore: string, daAltroComponente: boolean) => {
      if (!categoria || !valore) return;
      const values = categorie.get(categoria) ?? new Map<string, boolean>();
      const existing = values.get(valore);
      if (existing === undefined || (existing === true && !daAltroComponente)) {
        values.set(valore, daAltroComponente);
      }
      categorie.set(categoria, values);
    };

    // Manuali: applicano per articolo, indipendentemente dalla commessa;
    // una riga può coprire più categorie separate da virgola. Mai "di un
    // altro componente" — non ha senso di questo concetto per le manuali.
    for (const m of manualByArticolo.get(r.codice_articolo) ?? []) {
      const cats  = (m.categoria ?? '').split(',').map(s => s.trim()).filter(Boolean);
      const chars = (m.caratteristiche_manuali ?? '').split(',').map(s => s.trim()).filter(Boolean);
      for (const cat of cats) for (const ch of chars) addChar(cat, ch, false);
    }

    // Automatiche (motore parole chiave): prima le proprie dell'articolo,
    // poi quelle trovate su ALTRI articoli della stessa commessa (marcate).
    for (const a of autoByKey.get(JSON.stringify([r.codice_articolo, r.commessa])) ?? []) {
      addChar(a.categoria, a.caratteristica, false);
    }
    for (const a of autoByCommessa.get(r.commessa) ?? []) {
      if (a.codice_articolo === r.codice_articolo) continue; // già gestita sopra
      addChar(a.categoria, a.caratteristica, true);
    }

    // Attributi BC: applicano per articolo (dato anagrafico), come le manuali.
    for (const attr of attrByArticolo.get(r.codice_articolo) ?? []) {
      if (attr.value) addChar(attr.categoria_label, attr.value, false);
    }

    const categorieOut = [...categorie.entries()].map(([categoria, values]) => ({
      categoria,
      caratteristiche: [...values.entries()]
        .map(([valore, daAltroComponente]) => ({ valore, daAltroComponente }))
        .sort((a, b) => a.valore.localeCompare(b.valore)),
    }));
    // 'X.EXTRA' sempre in fondo, come nel vecchio OperatorOrders.jsx
    categorieOut.sort((a, b) => {
      if (a.categoria === 'X.EXTRA') return 1;
      if (b.categoria === 'X.EXTRA') return -1;
      return a.categoria.localeCompare(b.categoria);
    });

    return {
      fonte_ordine:      r.fonte_ordine,
      codice_articolo:   r.codice_articolo,
      commessa:          r.commessa,
      descrizione:       r.descrizione,
      ubicazione:        r.ubicazione,
      insertion_line_ts: r.insertion_line_ts,
      insertion_schedulato: r.insertion_schedulato,
      chiuso:            r.chiuso,
      colore:            r.colore,
      categorie:         categorieOut,
    };
  });

  return { rows, total };
}

// ─── Conflitti da risolvere in Dynamics ────────────────────────────────────────
// Gruppi (categoria componente, commessa) con più di un articolo candidato —
// segnala un probabile doppione in BC (o EDI) da chiudere/correggere a mano.
// A differenza del foglio, NON richiede una data di ingresso in linea: lo
// scopo è intercettare il problema il prima possibile, anche prima che la
// commessa entri in linea.

export interface ComponentConflictCandidate {
  codice_articolo: string;
  fonte_ordine:    'confermato' | 'forecast';
  fonte_recency:   string | null;
  descrizione:     string | null;
  is_winner:       boolean;
}

export interface ComponentConflict {
  categoria:  string;
  commessa:   string;
  candidates: ComponentConflictCandidate[];
}

export async function findComponentConflicts(): Promise<ComponentConflict[]> {
  const orderRows = await db<UnifiedOrderRow[]>`
    SELECT u.fonte_ordine, u.codice_articolo, u.commessa, u.descrizione,
           NULL::text AS ubicazione, NULL::text AS insertion_line_ts, FALSE AS insertion_schedulato,
           NULL::text AS colore, u.fonte_recency::text AS fonte_recency, FALSE AS chiuso
    FROM prod_order_unified u
  `;
  const deduped = dedupByArticoloCommessa(orderRows);

  const codes = [...new Set(deduped.map(r => r.codice_articolo))];
  const categoryMap = await loadCategoryMap(codes);
  if (categoryMap.size === 0) return [];

  const { grouped } = groupByCategoriaCommessa(deduped, categoryMap);

  const conflicts: ComponentConflict[] = [];
  for (const group of grouped.values()) {
    if (group.rows.length < 2) continue;
    const winner = pickWinner(group.rows);
    conflicts.push({
      categoria: group.categoria,
      commessa:  group.commessa,
      candidates: group.rows.map(r => ({
        codice_articolo: r.codice_articolo,
        fonte_ordine:    r.fonte_ordine,
        fonte_recency:   r.fonte_recency,
        descrizione:     r.descrizione,
        is_winner:       r === winner,
      })),
    });
  }

  conflicts.sort((a, b) => a.commessa.localeCompare(b.commessa) || a.categoria.localeCompare(b.categoria));
  return conflicts;
}

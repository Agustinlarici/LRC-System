export interface ProdSheetCaratteristica {
  valore:            string;
  // true se trovata solo nella descrizione di un ALTRO componente della
  // stessa commessa (es. la livrea trovata nel parabrezza, utile anche per
  // chi monta il paraurti) — il frontend la evidenzia con un colore diverso.
  daAltroComponente: boolean;
}

export interface ProdSheetCategoria {
  categoria:       string;
  caratteristiche: ProdSheetCaratteristica[];
}

export interface ProdSheetRow {
  fonte_ordine:      'confermato' | 'forecast';
  codice_articolo:   string;
  commessa:          string;
  descrizione:       string | null;
  ubicazione:        string | null;
  insertion_line_ts: string | null;
  colore:            string | null;
  categorie:         ProdSheetCategoria[];
}

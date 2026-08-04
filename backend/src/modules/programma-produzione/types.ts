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
  // true se la data viene da una riga "Schedulato" nell'import SPMA (non
  // ancora fisicamente in linea) invece che "avviato"/"in sequenza".
  insertion_schedulato: boolean;
  // TRUE se l'ordine Confermato è stato chiuso/evaso in BC (present_now =
  // FALSE) — resta visibile come storico invece di sparire dal foglio.
  chiuso:            boolean;
  colore:            string | null;
  categorie:         ProdSheetCategoria[];
}

export interface ProdSheetCategoria {
  categoria:       string;
  caratteristiche: string[];
}

export interface ProdSheetRow {
  codice_articolo:   string;
  commessa:          string;
  descrizione:       string | null;
  ubicazione:        string | null;
  insertion_line_ts: string | null;
  colore:            string | null;
  categorie:         ProdSheetCategoria[];
}

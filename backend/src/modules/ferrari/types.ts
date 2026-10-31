// Tipi condivisi del modulo Schede Ferrari. Il contratto dei pacchetti e' in docs/FERRARI-FLUSSO.md.

export const TIPI_COMPONENTE = [
  'ZONA', 'LATO', 'MATERIALE', 'COLORE', 'CODICE_VERNICE', 'FILO', 'CUCITURA',
  'LOGO_SCRITTA', 'RIFERIMENTO_IMMAGINI', 'PLACEHOLDER', 'ALTRO',
] as const;
export type TipoComponente = typeof TIPI_COMPONENTE[number];

export type Origine = 'valore' | 'nota' | 'blocco';

// ─── JSON canonico (uscita della normalizzazione, identico per VM e IA) ───────

export interface BloccoTesto { n: number; righe: number[]; testo: string }

export interface Opzione {
  riga:           number;          // riga Excel (1-based) della riga con il codice
  sezione:        string | null;
  codice:         string;
  descrizione:    string;
  valore:         string;
  nota:           string;
  blocchi_testo:  BloccoTesto[];
  /** Controllo delle righe toccate a mano (vedi anomalie.ts): frasi, codice suggerito e avvisi dell'intera scheda. */
  anomalie?:        string[];
  suggerito?:       string | null;
  scheda_anomalie?: { codice: string; riga: number | null; motivo: string }[];
}

export type LivelloAnomalia = 'info' | 'attenzione' | 'errore';
export interface Anomalia { tipo: string; riga: number | null; livello: LivelloAnomalia; dettaglio: string }

export interface HeaderScheda {
  commessa:        string | null;
  variante:        { codice: string | null; revisione: string | null; data: string | null };
  tipo_matricola:  { raw: string | null; modello: string | null; versione: string | null;
                     mercato_codice: string | null; mercato_sigla: string | null;
                     matricola: string | null; progressivo: string | null };
  destinazione:    { paese: string | null; codice_mercato: string | null; raw_mrkt: string | null };
  telaio:          string | null;
}

export interface CellaGrezza { addr: string; riga: number; col: number; value: string }

export interface Canonico {
  schema_version: 1;
  source:   { filename: string; sha256: string; format: string; sheet: string };
  header:   HeaderScheda;
  opzioni:  Opzione[];
  anomalie: Anomalia[];
  celle:    CellaGrezza[];
}

// ─── Conoscenza (dizionari approvati) ─────────────────────────────────────────

export interface CodiceNoto { codice: string; modello: string | null; significato: string; categoria: string | null }
export interface ComponenteNoto { pattern: string; tipo: string; valore: string; modello: string | null }
export interface Conoscenza { versione: number; codici: CodiceNoto[]; componenti: ComponenteNoto[] }

// ─── Analisi VM ───────────────────────────────────────────────────────────────

export interface Componente {
  tipo:      string;
  valore:    string;
  frammento: string;               // testo originale (con le maiuscole della scheda)
  start:     number;               // offset nel testo normalizzato dell'unita'
  end:       number;
  origine:   'dizionario' | 'regola';
}

export interface Residuo { testo: string; start: number; end: number }

export interface UnitaTesto {
  origine:    Origine;
  n:          number;              // indice del blocco (0 per valore/nota)
  righe:      number[];
  testo:      string;
  componenti: Componente[];
  residuo:    Residuo[];
  flags:      string[];            // 'immagini' | 'placeholder' | 'attenzione'
}

export type ClasseValore = 'SI' | 'EXTRACAMPIONARIO' | 'NUMERO' | 'TESTO' | 'VUOTO';

export interface OpzioneVm {
  riga:           number;
  sezione:        string | null;
  codice:         string;
  descrizione:    string;
  valore:         string;
  classe_valore:  ClasseValore;
  nota:           string;
  codice_noto:    boolean;
  significato:    string | null;
  unita:          UnitaTesto[];
}

export interface ControlloMercato {
  coerente: boolean;
  dettaglio: string;
  valori: Record<string, string | null>;
}

export interface AnalisiVm {
  motore:               string;
  versione_conoscenza:  number;
  header:               HeaderScheda;
  mercato:              ControlloMercato;
  opzioni:              OpzioneVm[];
  anomalie:             Anomalia[];
}

// ─── Analisi IA (dal pacchetto from-ai) ───────────────────────────────────────

export interface ComponenteIa { tipo: string; valore: string; frammento: string }
export interface OpzioneIa {
  riga:        number;
  codice:      string;
  componenti:  ComponenteIa[];
  sconosciuti: { testo: string; motivo?: string }[];
  ambigui:     { testo: string; motivo?: string }[];
  incoerenze:  { descrizione: string }[];
}
export interface AnalisiIa {
  schema_version: 1;
  file_id:        string;          // identificatore opaco del file nel lotto (non l'id DB)
  source_sha256:  string;
  modello:        { valore: string } | null;
  mercato:        { valore: string } | null;
  opzioni:        OpzioneIa[];
  incoerenze_generali: { descrizione: string }[];
  run: {
    ollama_model: string; prompt_version: string; knowledge_version: number; seconds: number;
    [k: string]: unknown;
  };
}

// ─── Confronto ────────────────────────────────────────────────────────────────

export type LivelloEsito = 'VERDE' | 'AMBRA' | 'ROSSO';

export interface ItemConfronto {
  key:         string;
  riga:        number | null;     // null = livello scheda
  codice:      string | null;
  livello:     'AMBRA' | 'ROSSO';
  tipo:        string;
  descrizione: string;
  origine?:    Origine;
  blocco?:     number;
  frammento?:  string;
  vm?:         Record<string, unknown> | null;
  ia?:         Record<string, unknown> | null;
}

export interface RisultatoConfronto {
  esito:         LivelloEsito;
  ia_assente:    boolean;
  versioni:      { vm: number; ia: number | null };
  header:        { campo: string; vm: string | null; ia: string | null; stato: string }[];
  items:         ItemConfronto[];
  righe:         { riga: number; codice: string; esito: LivelloEsito }[];
}

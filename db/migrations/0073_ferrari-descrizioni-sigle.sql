-- Schede Ferrari: descrizione di una sigla (es. BIC2 = CARROZZERIA BICOLORE), scritta da una persona (anche con il caricamento
-- massivo) o confermata dopo che l'Excel la proponeva. Compare nella colonna: «CARROZZERIA BICOLORE (BIC2)».
-- rifiutata = la persona ha detto «no» alla descrizione proposta dall'Excel: non si propone piu'.
CREATE TABLE IF NOT EXISTS ferrari_sigla_descrizione (
  codice      TEXT        PRIMARY KEY,
  descrizione TEXT        NOT NULL DEFAULT '',
  rifiutata   BOOLEAN     NOT NULL DEFAULT FALSE,
  fonte       TEXT        NOT NULL DEFAULT 'utente' CHECK (fonte IN ('utente', 'excel')),
  creato_da   TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

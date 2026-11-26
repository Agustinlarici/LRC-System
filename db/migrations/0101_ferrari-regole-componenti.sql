-- Regole dei componenti (stile Outlook): SE la scheda ha / non ha certe sigle, ALLORA aggiungi un valore a un componente.
-- Tabella nuova (nessun dato esistente toccato): il codice precedente continua a funzionare con questo schema.
CREATE TABLE IF NOT EXISTS ferrari_regola_comp (
  id             BIGSERIAL PRIMARY KEY,
  ordine         INTEGER     NOT NULL,
  nome           TEXT        NOT NULL,
  attiva         BOOLEAN     NOT NULL DEFAULT true,
  modello        TEXT        NOT NULL DEFAULT '*',          -- '*' = tutti i modelli
  logica         TEXT        NOT NULL DEFAULT 'tutte' CHECK (logica IN ('tutte', 'qualsiasi')),
  condizioni     JSONB       NOT NULL DEFAULT '[]'::jsonb,
  eccezioni      JSONB       NOT NULL DEFAULT '[]'::jsonb,
  azioni         JSONB       NOT NULL DEFAULT '[]'::jsonb,
  ferma          BOOLEAN     NOT NULL DEFAULT false,         -- «non applicare le regole seguenti» (come in Outlook)
  creato_da      TEXT,
  aggiornato_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ferrari_regola_comp_ordine ON ferrari_regola_comp (ordine, id);

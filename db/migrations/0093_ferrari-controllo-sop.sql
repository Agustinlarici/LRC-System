-- Schede Ferrari: controllo con il SOP (riepilogo fatto a mano, una riga per commessa). Si carica l'Excel del SOP e la VM lo confronta,
-- colonna per colonna, con quello che legge dalle schede. Le regole dicono come ricavare ogni colonna dalla scheda. Solo tabelle nuove.
CREATE TABLE IF NOT EXISTS ferrari_sop_import (
  id          BIGSERIAL   PRIMARY KEY,
  filename    TEXT        NOT NULL,
  colonne     JSONB       NOT NULL,
  righe       INTEGER     NOT NULL,
  con_dati    INTEGER     NOT NULL,
  caricato_da TEXT,
  caricato_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ferrari_sop_riga (
  import_id BIGINT NOT NULL REFERENCES ferrari_sop_import(id) ON DELETE CASCADE,
  commessa  TEXT   NOT NULL,
  valori    JSONB  NOT NULL,
  PRIMARY KEY (import_id, commessa)
);

CREATE TABLE IF NOT EXISTS ferrari_sop_regola (
  colonna       TEXT        PRIMARY KEY,
  ordine        INTEGER     NOT NULL DEFAULT 0,
  tipo          TEXT        NOT NULL CHECK (tipo IN ('sigle', 'colore', 'mercato')),
  parametri     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  aggiornato_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edi_ferrari_delins (
  id                        BIGSERIAL   PRIMARY KEY,
  source_file               TEXT        NOT NULL DEFAULT '',
  num_programma             TEXT        NOT NULL DEFAULT '',
  data_documento            TEXT        NOT NULL DEFAULT '',
  mittente                  TEXT        NOT NULL DEFAULT '',
  fornitore                 TEXT        NOT NULL DEFAULT '',
  app_reference             TEXT        NOT NULL DEFAULT '',
  tipo_messaggio            TEXT        NOT NULL DEFAULT '',
  data_validita             TEXT        NOT NULL DEFAULT '',
  codice_stabilimento       TEXT        NOT NULL DEFAULT '',
  codice_articolo           TEXT        NOT NULL DEFAULT '',
  commessa                  TEXT        NOT NULL DEFAULT '',
  descrizione               TEXT        NOT NULL DEFAULT '',
  um                        TEXT        NOT NULL DEFAULT '',
  num_contratto             TEXT        NOT NULL DEFAULT '',
  pos_contratto             TEXT        NOT NULL DEFAULT '',
  frequenza_codice          TEXT        NOT NULL DEFAULT '',
  frequenza                 TEXT        NOT NULL DEFAULT '',
  tipo_documento            TEXT        NOT NULL DEFAULT '',
  ft3_testo                 TEXT        NOT NULL DEFAULT '',
  data_calcolo              TEXT        NOT NULL DEFAULT '',
  progressivo_programmato   TEXT        NOT NULL DEFAULT '',
  progressivo_ricevuto      TEXT        NOT NULL DEFAULT '',
  anticipo_ritardo          TEXT        NOT NULL DEFAULT '',
  pdn_num_rimesso           TEXT        NOT NULL DEFAULT '',
  pdn_data_rimesso          TEXT        NOT NULL DEFAULT '',
  pdn_qty_dichiarata        TEXT        NOT NULL DEFAULT '',
  pdn_qty_ricevuta          TEXT        NOT NULL DEFAULT '',
  pdn_data_ricevimento      TEXT        NOT NULL DEFAULT '',
  data_consegna             TEXT        NOT NULL DEFAULT '',
  quantita                  TEXT        NOT NULL DEFAULT '',
  tipo_schedulazione_codice TEXT        NOT NULL DEFAULT '',
  tipo_schedulazione        TEXT        NOT NULL DEFAULT '',
  file_mtime                TIMESTAMPTZ,
  scanned_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS edi_ferrari_delins_num_programma_idx
  ON edi_ferrari_delins (num_programma);
CREATE INDEX IF NOT EXISTS edi_ferrari_delins_tipo_documento_idx
  ON edi_ferrari_delins (tipo_documento);
CREATE INDEX IF NOT EXISTS edi_ferrari_delins_commessa_idx
  ON edi_ferrari_delins (commessa);
CREATE INDEX IF NOT EXISTS edi_ferrari_delins_scanned_at_idx
  ON edi_ferrari_delins (scanned_at DESC);

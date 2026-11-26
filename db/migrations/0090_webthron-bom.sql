-- ============================================================
-- BOM da iKnow: copia locale aggiornata una volta a notte
-- Tabella webthron_bom (una riga per documento BOM di ubidocum) e vista v_iknow_bom per Power BI.
-- Tabella e vista nuove: il codice vecchio le ignora.
-- ============================================================

CREATE TABLE IF NOT EXISTS webthron_bom (
  iddocu           BIGINT        PRIMARY KEY,   -- ubidocum.iddocu
  data_inserimento TIMESTAMPTZ,                 -- ubidocum.datain
  codice_vendita   VARCHAR(200),                -- campo iKnow 205
  descrizione      VARCHAR(500),                -- campo 246
  modello          VARCHAR(200),                -- campo 43  (lista, testo da ikExtraTab)
  codint           VARCHAR(200),                -- campo 265
  componente       VARCHAR(200),                -- campo 45  (lista)
  versione         VARCHAR(200),                -- campo 44  (lista)
  aggiornato_il    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webthron_bom_codice_vendita ON webthron_bom (codice_vendita);

CREATE OR REPLACE VIEW v_iknow_bom AS
SELECT
  data_inserimento,
  codice_vendita,
  descrizione,
  modello,
  codint,
  componente,
  versione
FROM webthron_bom;

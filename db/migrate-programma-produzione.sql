-- ============================================================
-- LRC-System — Programma Produzione Module Migration
-- Porta e rinnova prod_ins_routes.py / schede/* di ProduzioneSTR:
--   - Ordini da Business Central (BC) + Forecast EDI (edi_ferrari_delins)
--   - Motore parole chiave (semplice + prossimità) e attributi articolo BC
--   - Colore da parole chiave
--   - Data di ingresso in linea condivisa con l'import di SPMA
--   - Foglio di lavoro stampabile per area di montaggio
--
-- Le tabelle prod_order / prod_operator_assignment / prod_article_info /
-- prod_article_auto / prod_article_color / prod_keyword_rules esistenti in
-- schema.sql erano solo un placeholder mai collegato a nessuna route (il
-- modulo era uno stub 501 in app.ts) e sono già state ridisegnate qui sotto
-- la prima volta che questo file è stato eseguito.
--
-- IMPORTANTE: nessuna istruzione DROP TABLE in questo file. Una volta che
-- il modulo è in uso, queste tabelle contengono config caricata a mano
-- (regole, aree, ecc.) — un DROP TABLE qui la cancellerebbe ad ogni
-- ri-esecuzione. Tutto è IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / DO
-- block difensivo, così questo file è sicuro da ri-eseguire quante volte
-- serve per aggiungere pezzi nuovi.
-- ============================================================

-- ─── Modulo & permessi ─────────────────────────────────────────────────────────

ALTER TYPE module_key_enum ADD VALUE IF NOT EXISTS 'programma_produzione';

INSERT INTO user_module_permissions (user_id, module_key, can_view, can_manage)
SELECT u.id, 'programma_produzione'::module_key_enum, TRUE, TRUE
FROM users u
WHERE u.username = 'Alarici'
ON CONFLICT (user_id, module_key)
  DO UPDATE SET can_view = TRUE, can_manage = TRUE;

-- ─── Aree di montaggio (selezione generica, senza login personale) ────────────

CREATE TABLE IF NOT EXISTS prod_area_montaggio (
    id           SERIAL PRIMARY KEY,
    code         VARCHAR(50) UNIQUE NOT NULL,
    description  VARCHAR(255)
);

-- prod_area_article (lista piatta di codici articolo per area) non è mai
-- stata usata — droppata (vedi sotto per lo storico dei tentativi successivi).
DROP TABLE IF EXISTS prod_area_article;

-- ─── Ordini confermati da Business Central (sync incrementale via row_sig) ────

CREATE TABLE IF NOT EXISTS prod_order (
    id                     BIGSERIAL PRIMARY KEY,
    codice_articolo        VARCHAR(100) NOT NULL,
    commessa               VARCHAR(100) NOT NULL,
    description            TEXT,
    description_extension  TEXT,
    ubicazione             VARCHAR(50),
    planned_shipment_date  DATE,
    shipment_date          DATE,
    fa_posting_date        DATE,
    present_now            BOOLEAN NOT NULL DEFAULT TRUE,
    last_seen_at           TIMESTAMPTZ,
    row_sig                CHAR(32) NOT NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (row_sig)
);

CREATE INDEX IF NOT EXISTS prod_order_commessa_articolo_idx ON prod_order (commessa, codice_articolo);
CREATE INDEX IF NOT EXISTS prod_order_present_now_idx       ON prod_order (present_now);

-- Data di registrazione dell'ordine in BC (Sales Line."Posting Date") — usata
-- per decidere quale riga è "l'ultima" quando due Confermato per la stessa
-- commessa+categoria componente si sovrappongono (vedi prod_article_component_category).
ALTER TABLE prod_order ADD COLUMN IF NOT EXISTS data_registrazione DATE;

-- ─── Data di ingresso in linea per commessa (tabella propria, separata da SPMA) ─
-- Popolata dallo stesso upload usato in /spma/import (vedi import-logic.ts):
-- un solo file aggiorna sia spma_commessa.line_entry_ts sia questa tabella.

CREATE TABLE IF NOT EXISTS prod_commessa_inserimenti (
    id                  SERIAL PRIMARY KEY,
    commessa            VARCHAR(100) NOT NULL,
    linea               VARCHAR(100),
    insertion_line_ts   TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'prod_commessa_inserimenti_commessa_key'
  ) THEN
    ALTER TABLE prod_commessa_inserimenti ADD CONSTRAINT prod_commessa_inserimenti_commessa_key UNIQUE (commessa);
  END IF;
END$$;

-- ─── Motore parole chiave: modo semplice o prossimità ─────────────────────────

DO $$ BEGIN
  CREATE TYPE prod_keyword_mode AS ENUM ('simple', 'proximity');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS prod_keyword_rules (
    id                      SERIAL PRIMARY KEY,
    prefisso_commessa       VARCHAR(10)  NOT NULL,
    categoria               VARCHAR(100) NOT NULL,
    caratteristica_derivata VARCHAR(150) NOT NULL,
    modo                    prod_keyword_mode NOT NULL DEFAULT 'simple',
    -- modo 'simple':
    parola_chiave           VARCHAR(150),
    -- modo 'proximity': parola_obiettivo entro N caratteri DOPO parola_ancora
    parola_ancora           VARCHAR(150),
    parola_obiettivo        VARCHAR(150),
    distanza_max_caratteri  INTEGER,
    note                    TEXT,
    active                  BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT prod_keyword_rules_modo_check CHECK (
      (modo = 'simple'
        AND parola_chiave          IS NOT NULL
        AND parola_ancora          IS NULL
        AND parola_obiettivo       IS NULL
        AND distanza_max_caratteri IS NULL)
      OR
      (modo = 'proximity'
        AND parola_chiave          IS NULL
        AND parola_ancora          IS NOT NULL
        AND parola_obiettivo       IS NOT NULL
        AND distanza_max_caratteri IS NOT NULL
        AND distanza_max_caratteri > 0)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS prod_keyword_rules_simple_uq
  ON prod_keyword_rules (prefisso_commessa, categoria, parola_chiave)
  WHERE modo = 'simple';

CREATE UNIQUE INDEX IF NOT EXISTS prod_keyword_rules_proximity_uq
  ON prod_keyword_rules (prefisso_commessa, categoria, parola_ancora, parola_obiettivo)
  WHERE modo = 'proximity';

CREATE INDEX IF NOT EXISTS prod_keyword_rules_prefisso_idx ON prod_keyword_rules (prefisso_commessa) WHERE active;

-- ─── Parole chiave colore (substring semplice, come prima) ────────────────────

CREATE TABLE IF NOT EXISTS prod_color_keywords (
    id       SERIAL PRIMARY KEY,
    keyword  VARCHAR(100) NOT NULL,
    color    VARCHAR(100) NOT NULL,
    active   BOOLEAN NOT NULL DEFAULT TRUE
);

ALTER TABLE prod_color_keywords ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

-- Permette upsert idempotente al re-importare lo stesso Excel di config.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'prod_color_keywords_keyword_key'
  ) THEN
    ALTER TABLE prod_color_keywords ADD CONSTRAINT prod_color_keywords_keyword_key UNIQUE (keyword);
  END IF;
END$$;

-- ─── Caratteristiche derivate (output del motore parole chiave) ───────────────
-- Granularità per articolo + commessa (non solo articolo): un articolo può
-- avere caratteristiche diverse in commesse diverse.

CREATE TABLE IF NOT EXISTS prod_article_auto (
    id              BIGSERIAL PRIMARY KEY,
    codice_articolo VARCHAR(100) NOT NULL,
    commessa        VARCHAR(100) NOT NULL,
    categoria       VARCHAR(100) NOT NULL,
    caratteristica  VARCHAR(150) NOT NULL,
    fonte           VARCHAR(30)  NOT NULL DEFAULT 'keyword',
    rule_id         INTEGER REFERENCES prod_keyword_rules(id) ON DELETE SET NULL,
    generated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (codice_articolo, commessa, categoria, caratteristica)
);

CREATE INDEX IF NOT EXISTS prod_article_auto_commessa_idx ON prod_article_auto (commessa);

-- ─── Colore rilevato per articolo + commessa ──────────────────────────────────

CREATE TABLE IF NOT EXISTS prod_article_color (
    codice_articolo VARCHAR(100) NOT NULL,
    commessa        VARCHAR(100) NOT NULL,
    colore          VARCHAR(100),
    fonte           VARCHAR(30),
    fa_posting_date DATE,
    detected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (codice_articolo, commessa)
);

-- ─── Caratteristiche manuali per articolo (curate a mano) ─────────────────────
-- Una riga può coprire più categorie/caratteristiche separate da virgola,
-- fedele al comportamento del vecchio prod_article_info.

CREATE TABLE IF NOT EXISTS prod_article_info (
    id                      SERIAL PRIMARY KEY,
    codice_articolo         VARCHAR(100) NOT NULL,
    modello                 VARCHAR(100),
    categoria               VARCHAR(200),
    caratteristiche_manuali TEXT
);

CREATE INDEX IF NOT EXISTS prod_article_info_articolo_idx ON prod_article_info (codice_articolo);

-- Permette upsert idempotente al re-importare lo stesso Excel di config.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'prod_article_info_articolo_categoria_key'
  ) THEN
    ALTER TABLE prod_article_info ADD CONSTRAINT prod_article_info_articolo_categoria_key UNIQUE (codice_articolo, categoria);
  END IF;
END$$;

-- ─── Attributi articolo da Business Central (Item Attribute Value Mapping+Value) ─

CREATE TABLE IF NOT EXISTS prod_item_attribute (
    id                       BIGSERIAL PRIMARY KEY,
    codice_articolo          VARCHAR(100) NOT NULL,
    item_attribute_id        INTEGER NOT NULL,
    item_attribute_value_id  INTEGER,
    value                    TEXT,
    synced_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (codice_articolo, item_attribute_id)
);

CREATE INDEX IF NOT EXISTS prod_item_attribute_articolo_idx ON prod_item_attribute (codice_articolo);

-- Nome di categoria assegnabile a ogni Item Attribute ID (tutti vengono
-- importati; senza un nome assegnato si mostra "Attributo #<id>").
CREATE TABLE IF NOT EXISTS prod_item_attribute_label (
    item_attribute_id INTEGER PRIMARY KEY,
    categoria_label    VARCHAR(150) NOT NULL,
    active             BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Log di sincronizzazione (BC / EDI / motore parole chiave / colore) ───────

CREATE TABLE IF NOT EXISTS prod_sync_log (
    id                  SERIAL PRIMARY KEY,
    sync_type           VARCHAR(30) NOT NULL,  -- 'bc_orders' | 'item_attributes' | 'keywords' | 'colors'
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at         TIMESTAMPTZ,
    rows_upserted       INTEGER,
    rows_marked_absent  INTEGER,
    status              VARCHAR(20) NOT NULL DEFAULT 'running',
    error_message       TEXT
);

CREATE INDEX IF NOT EXISTS prod_sync_log_type_idx ON prod_sync_log (sync_type, started_at DESC);

-- ─── Indice per il filtro Forecast su edi_ferrari_delins ──────────────────────
-- edi_ferrari_delins ha ~180k righe "Forecast", di cui solo quelle con
-- commessa/codice_articolo valorizzati ci servono (~20k). Senza un indice
-- dedicato, prod_order_unified fa un Seq Scan sull'intera tabella ad ogni
-- query — misurato a 5-6s da solo. Indice parziale sulle stesse condizioni
-- del filtro nella view sottostante.

CREATE INDEX IF NOT EXISTS edi_ferrari_delins_forecast_commessa_idx
  ON edi_ferrari_delins (commessa, codice_articolo)
  WHERE (tipo_documento = 'Forecast' OR tipo_schedulazione = 'Forecast')
    AND commessa <> '' AND codice_articolo <> '';

-- ─── Categoria componente + area per articolo ─────────────────────────────────
-- Una riga per codice articolo, con due campi indipendenti:
--   categoria: per il rimpiazzo "vince l'ultimo" (vedi sheet.ts) — se più
--     articoli della stessa categoria arrivano per la stessa commessa, se ne
--     tiene uno solo: Confermato batte Forecast, a parità di fonte vince il
--     più recente (fonte_recency). La categoria NON dipende dall'area: due
--     codici della stessa categoria ma di aree diverse continuano a competere
--     tra loro (utile per scoprire errori cross-modello in Dynamics).
--   area_id: quale area di montaggio mostra questo codice nel foglio —
--     indipendente dalla categoria, così due aree possono avere codici
--     diversi della stessa categoria senza inventare nomi tipo
--     "PARAURTI-LINEA1"/"PARAURTI-LINEA2".

CREATE TABLE IF NOT EXISTS prod_article_component_category (
    id              SERIAL PRIMARY KEY,
    codice_articolo VARCHAR(100) NOT NULL UNIQUE,
    categoria       VARCHAR(100) NOT NULL
);

CREATE INDEX IF NOT EXISTS prod_article_component_category_categoria_idx
  ON prod_article_component_category (categoria);

ALTER TABLE prod_article_component_category ALTER COLUMN categoria DROP NOT NULL;
ALTER TABLE prod_article_component_category ADD COLUMN IF NOT EXISTS area_id INTEGER REFERENCES prod_area_montaggio(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS prod_article_component_category_area_idx ON prod_article_component_category (area_id);

-- Backfill da prod_area_categoria (modello precedente: area↔categoria) prima
-- di droppare la tabella — non perde le assegnazioni già fatte a mano.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'prod_area_categoria') THEN
    UPDATE prod_article_component_category pacc
    SET area_id = pac.area_id
    FROM prod_area_categoria pac
    WHERE pac.categoria = pacc.categoria
      AND pacc.area_id IS NULL;
  END IF;
END$$;

DROP TABLE IF EXISTS prod_area_categoria;

-- ─── Vista unificata: Confermato (BC) sempre vince su Forecast (EDI) ──────────
-- Per la stessa coppia (commessa, codice_articolo): se esiste un ordine BC
-- presente (present_now), il Forecast per quella coppia viene scartato.
-- fonte_recency: segnale per decidere "l'ultimo" tra due righe della stessa
-- fonte (stessa categoria componente, stessa commessa, articoli diversi) —
-- data di registrazione BC per Confermato, data/scan del file EDI per Forecast.

CREATE OR REPLACE VIEW prod_order_unified AS
SELECT
    'confermato'::VARCHAR(12)   AS fonte_ordine,
    po.codice_articolo,
    po.commessa,
    po.description               AS descrizione,
    po.description_extension     AS descrizione_estesa,
    po.ubicazione,
    po.planned_shipment_date,
    po.shipment_date,
    po.fa_posting_date,
    NULL::TEXT                   AS data_consegna_forecast,
    po.data_registrazione::TIMESTAMPTZ AS fonte_recency
FROM prod_order po
WHERE po.present_now = TRUE
  AND po.codice_articolo <> ''
  AND po.commessa <> ''

UNION ALL

SELECT
    'forecast'::VARCHAR(12)      AS fonte_ordine,
    d.codice_articolo,
    d.commessa,
    d.descrizione,
    d.ft3_testo                  AS descrizione_estesa,
    NULL::VARCHAR(50)            AS ubicazione,
    NULL::DATE                   AS planned_shipment_date,
    NULL::DATE                   AS shipment_date,
    NULL::DATE                   AS fa_posting_date,
    d.data_consegna,
    COALESCE(d.file_mtime, d.scanned_at) AS fonte_recency
FROM edi_ferrari_delins d
WHERE (d.tipo_documento = 'Forecast' OR d.tipo_schedulazione = 'Forecast')
  AND d.codice_articolo <> ''
  AND d.commessa <> ''
  AND NOT EXISTS (
    SELECT 1 FROM prod_order po2
    WHERE po2.present_now     = TRUE
      AND po2.commessa        = d.commessa
      AND po2.codice_articolo = d.codice_articolo
  );

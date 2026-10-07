-- ============================================================
-- LRC-System — HR: archivio documenti e modelli lettera
-- Run AFTER migrate-hr.sql
-- Safe to re-run: i documenti di partenza vengono creati UNA sola volta
-- (un documento eliminato dall'interfaccia non ricompare ai deploy successivi)
-- ============================================================

-- Un documento può essere:
--  'modello'      → .docx con segnaposto {nome}, {cognome}… compilabile per un dipendente
--                   oppure scaricabile vuoto (segnaposto sostituiti da ________)
--  'consultazione'→ file che si archivia e si scarica così com'è (PDF, normative, ecc.)
-- event_type collega un modello a un tipo di evento della timeline (o a
-- 'aumento_retributivo'), per proporlo in automatico quando viene registrato.
-- Il file sta nel DB (bytea): pochi file piccoli, finisce nel backup insieme al resto
-- e non dipende da volumi Docker.

-- Segnalino "documenti di partenza già creati". Se la tabella hr_document esiste già
-- (installazione precedente a questo segnalino) i documenti di partenza sono già stati
-- creati: si segna come fatto senza ricrearli, così quelli eliminati restano eliminati.
DO $$ BEGIN
  IF to_regclass('public.hr_document_seed_done') IS NULL
     AND to_regclass('public.hr_document') IS NOT NULL THEN
    CREATE TABLE hr_document_seed_done (done BOOLEAN PRIMARY KEY DEFAULT true);
    INSERT INTO hr_document_seed_done VALUES (true);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS hr_document (
  id                SERIAL PRIMARY KEY,
  name              VARCHAR(150) NOT NULL UNIQUE,
  description       VARCHAR(255),
  kind              VARCHAR(20) NOT NULL DEFAULT 'modello' CHECK (kind IN ('modello', 'consultazione')),
  event_type        VARCHAR(40),                    -- tipo evento timeline o 'aumento_retributivo'
  file_name         VARCHAR(255),
  file_mime         VARCHAR(120),
  file_size         INTEGER,
  file_data         BYTEA,
  placeholders      TEXT[] NOT NULL DEFAULT '{}',   -- segnaposto trovati nel file all'upload
  sort_order        INTEGER NOT NULL DEFAULT 0,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  uploaded_by_name  VARCHAR(150),
  uploaded_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Se la tabella esisteva già con il tipo enum, lo si porta a testo
ALTER TABLE hr_document ALTER COLUMN event_type TYPE VARCHAR(40) USING event_type::text;

-- Documenti di partenza: voci vuote in attesa del file .docx (solo alla prima esecuzione)
DO $$ BEGIN
  IF to_regclass('public.hr_document_seed_done') IS NULL THEN
    CREATE TABLE hr_document_seed_done (done BOOLEAN PRIMARY KEY DEFAULT true);
    INSERT INTO hr_document_seed_done VALUES (true);

    INSERT INTO hr_document (name, description, kind, event_type, sort_order) VALUES
      ('Lettera cambio mansione',                       'Comunicazione al dipendente di variazione della mansione',  'modello', 'cambio_mansione',     1),
      ('Lettera cambio mansione per prescrizioni MDL',  'Cambio mansione per prescrizioni del medico del lavoro',    'modello', NULL,                  2),
      ('Variazione inquadramento contrattuale',         'Variazione del livello / inquadramento',                    'modello', 'cambio_livello',      3),
      ('Lettera adeguamento retributivo',               'Comunicazione di adeguamento della retribuzione',           'modello', 'aumento_retributivo', 4),
      ('Lettera trasferimento stabilimento',            'Trasferimento del dipendente ad altro stabilimento',        'modello', 'trasferimento',       5),
      ('Certificato scuola',                            'Certificato per istituti scolastici',                       'modello', NULL,                  6)
    ON CONFLICT (name) DO NOTHING;
  END IF;
END $$;

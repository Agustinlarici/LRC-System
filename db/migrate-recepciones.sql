-- Ricezione documenti di trasporto (DDT) — scanner ingresso
ALTER TYPE module_key_enum ADD VALUE IF NOT EXISTS 'recepciones';

CREATE TABLE IF NOT EXISTS recepciones (
  id_ddt        SERIAL       PRIMARY KEY,
  pdf_path      TEXT         NOT NULL DEFAULT '',
  proveedor     TEXT,
  numero_ddt    TEXT,
  fecha_ddt     DATE,
  destinatario  TEXT,
  confianza_ia  VARCHAR(10)  CHECK (confianza_ia IN ('alta', 'media', 'baja')),
  estado        VARCHAR(20)  NOT NULL DEFAULT 'revision_manual'
                             CHECK (estado IN ('confirmado', 'revision_manual')),
  escaner_id    VARCHAR(50)  NOT NULL DEFAULT 'ingreso-01',
  creado_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  confirmado_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_recepciones_creado_at ON recepciones (creado_at DESC);
CREATE INDEX IF NOT EXISTS idx_recepciones_estado    ON recepciones (estado);

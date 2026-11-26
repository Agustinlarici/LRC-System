-- ============================================================
-- LRC-System — HR: vestiario per capo + colore e taglie per dipendente
-- ============================================================
-- hr_capo: catalogo dei capi (nome + colore, es. «FELPA BCWG004» / «GRIGIA»).
-- hr_capo_taglia: taglia assegnata a un dipendente per un capo.
-- Solo tabelle nuove: le colonne taglia_* di hr_employee restano com'erano.

CREATE TABLE IF NOT EXISTS hr_capo (
  id         SERIAL PRIMARY KEY,
  nome       VARCHAR(120) NOT NULL,
  colore     VARCHAR(60)  NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (nome, colore)
);

CREATE TABLE IF NOT EXISTS hr_capo_taglia (
  employee_id INTEGER     NOT NULL REFERENCES hr_employee(id) ON DELETE CASCADE,
  capo_id     INTEGER     NOT NULL REFERENCES hr_capo(id)     ON DELETE CASCADE,
  taglia      VARCHAR(10) NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (employee_id, capo_id)
);

CREATE INDEX IF NOT EXISTS idx_hr_capo_taglia_capo ON hr_capo_taglia (capo_id);

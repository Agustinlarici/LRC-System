-- ============================================================
-- LRC-System — HR: etichette colorate, "in prova", avvisi import
-- Run AFTER migrate-hr.sql
-- Safe to re-run: CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS
-- ============================================================

-- ─── Etichette (pallino colorato) — catalogo gestito da HR ───────────────────
-- Un'unica etichetta per dipendente (colore + significato), es. "Da rivedere",
-- "Attenzione", ecc. Il significato è libero e modificabile da HR, non fisso nel codice.
CREATE TABLE IF NOT EXISTS hr_employee_tag (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(60) NOT NULL,
  color       VARCHAR(20) NOT NULL DEFAULT 'gray',
  description VARCHAR(255),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE hr_employee ADD COLUMN IF NOT EXISTS tag_id INTEGER REFERENCES hr_employee_tag(id);
CREATE INDEX IF NOT EXISTS idx_hr_employee_tag ON hr_employee(tag_id);

-- ─── In prova — casella manuale, senza date né calcolo automatico ────────────
ALTER TABLE hr_employee ADD COLUMN IF NOT EXISTS in_prova BOOLEAN NOT NULL DEFAULT FALSE;

-- ─── Avviso import — riga caricata dall'Excel con dati incompleti/incerti:
-- non viene più scartata, resta visibile finché qualcuno non la corregge e pulisce l'avviso.
ALTER TABLE hr_employee ADD COLUMN IF NOT EXISTS import_warning TEXT;

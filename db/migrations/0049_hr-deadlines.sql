-- ============================================================
-- LRC-System — HR: regole di avviso scadenze (data_cessazione)
-- Run AFTER migrate-hr.sql
-- Safe to re-run: CREATE TABLE IF NOT EXISTS
-- ============================================================

-- Una regola si applica ai dipendenti che corrispondono ai suoi filtri (società
-- contratto e/o in_prova — NULL su un filtro significa "qualsiasi") e dice quanti
-- giorni prima della data_cessazione mostrare l'avviso. La prima regola attiva che
-- corrisponde (per sort_order) vince — così si possono avere regole più specifiche
-- prima e una generica di fallback alla fine.
CREATE TABLE IF NOT EXISTS hr_deadline_rule (
  id                   SERIAL PRIMARY KEY,
  label                VARCHAR(150),
  contract_company_id  INTEGER REFERENCES hr_contract_company(id),
  in_prova             BOOLEAN,
  giorni_avviso        INTEGER NOT NULL,
  sort_order           INTEGER NOT NULL DEFAULT 0,
  is_active            BOOLEAN NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hr_deadline_rule_company ON hr_deadline_rule(contract_company_id);

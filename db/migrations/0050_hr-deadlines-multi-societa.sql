-- ============================================================
-- LRC-System — Scadenze: una regola può filtrare per più società insieme
-- Run AFTER migrate-hr-deadlines.sql
-- Safe to re-run: ADD COLUMN IF NOT EXISTS
-- ============================================================

-- contract_company_ids vuoto ('{}') = qualsiasi società, come prima il NULL singolo.
ALTER TABLE hr_deadline_rule ADD COLUMN IF NOT EXISTS contract_company_ids INTEGER[] NOT NULL DEFAULT '{}';
UPDATE hr_deadline_rule SET contract_company_ids = ARRAY[contract_company_id]
  WHERE contract_company_id IS NOT NULL AND contract_company_ids = '{}';
ALTER TABLE hr_deadline_rule DROP COLUMN IF EXISTS contract_company_id;

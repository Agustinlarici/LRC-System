-- ============================================================
-- LRC-System — HR: tipo di contratto nella tabella dei contratti
-- Una persona può avere contratti STR e contratti interinali (o esterni): la scheda li
-- mostra insieme con una colonna "Tipo". Colonna nullable: i contratti già presenti
-- (tutti dall'import interinali) restano NULL e la scheda li mostra come Interinale.
-- ============================================================

ALTER TABLE hr_employee_contract ADD COLUMN IF NOT EXISTS tipo VARCHAR(20);

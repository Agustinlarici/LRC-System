-- ============================================================
-- Allineamento con lo schema di produzione (da db/check-drift.sh, 20/10/2026)
-- ============================================================

-- 1. monitor_turno_default: creata finora solo all'avvio del backend (index.ts),
--    mancava nelle migrazioni. Definizione identica a quella di produzione.
CREATE TABLE IF NOT EXISTS monitor_turno_default (
  id                   SERIAL PRIMARY KEY,
  linea_id             INTEGER NOT NULL REFERENCES monitor_linea(id) ON DELETE CASCADE,
  day_of_week          INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  t1_inizio            TIME,
  t1_fine              TIME,
  t2_inizio            TIME,
  t2_fine              TIME,
  quantita_giornaliera INTEGER,
  pause                JSONB NOT NULL DEFAULT '[]',
  UNIQUE (linea_id, day_of_week)
);

-- 2. hr_employee_capo: non usata dal codice (sostituita da hr_capo_pair) e già
--    assente in produzione.
DROP TABLE IF EXISTS hr_employee_capo;

-- 3. Vincoli di integrità SPMA presenti nelle migrazioni ma assenti in produzione.
--    Se esistono righe "orfane" il vincolo non si può creare: la migrazione si
--    ferma (rollback completo) e il deploy torna alla versione precedente.
DO $$
DECLARE
  fk RECORD;
BEGIN
  FOR fk IN SELECT * FROM (VALUES
    ('lead_time_zones',        'lead_time_zones_category_id_fkey',                 'category_id',           'spma_component_category'),
    ('spma_category_keywords', 'spma_category_keywords_category_id_fkey',          'category_id',           'spma_component_category'),
    ('spma_componente_map',    'spma_componente_map_component_category_id_fkey',   'component_category_id', 'spma_component_category'),
    ('spma_fase_sequence',     'spma_fase_sequence_component_category_id_fkey',    'component_category_id', 'spma_component_category'),
    ('spma_picking_issue_log', 'spma_picking_issue_log_plan_id_fkey',              'plan_id',               'spma_plan')
  ) AS t(tbl, name, col, ref)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk.name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(id) ON DELETE CASCADE',
                     fk.tbl, fk.name, fk.col, fk.ref);
      RAISE NOTICE 'creato vincolo %', fk.name;
    END IF;
  END LOOP;
END $$;

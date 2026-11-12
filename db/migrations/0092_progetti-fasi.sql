-- ============================================================
-- LRC-System — Progetti: fasi con scadenza
--
-- Le attività di un progetto si raggruppano in fasi (es. Rilevamento → Acquisto →
-- Installazione), ognuna con la sua scadenza. La scadenza del progetto è quella
-- fissata a mano (projects.due_date) oppure, se manca, quella dell'ultima fase.
-- Solo aggiunte (tabella nuova + colonna nullable): il codice precedente regge lo schema nuovo.
-- Run AFTER 0082_progetti.sql
-- Safe to re-run: IF NOT EXISTS
-- ============================================================

CREATE TABLE IF NOT EXISTS project_phases (
  id         SERIAL PRIMARY KEY,
  project_id INTEGER      NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       VARCHAR(200) NOT NULL,
  start_date DATE,                       -- facoltativa: se manca, la fase parte alla scadenza della precedente
  due_date   DATE,
  sort_order INTEGER      NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_phases_project ON project_phases(project_id, sort_order);

-- Eliminare una fase non elimina le attività: tornano «senza fase».
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS phase_id INTEGER REFERENCES project_phases(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_project_tasks_phase ON project_tasks(phase_id);

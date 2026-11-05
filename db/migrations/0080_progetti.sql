-- ============================================================
-- LRC-System — Progetti: livello di gestione progetti sopra i ticket
--
-- Un progetto raggruppa ticket esistenti (tickets.project_id, nullable: un ticket
-- sta in 0 o 1 progetto) e ha attività (project_tasks) e un diario (project_log).
-- Lo storico dei ticket NON si copia: la cronologia del progetto lo legge da
-- ticket_history. Solo aggiunte (tabelle nuove + colonna nullable): il codice
-- precedente regge lo schema nuovo.
-- Run AFTER migrate-tickets.sql
-- Safe to re-run: IF NOT EXISTS
-- ============================================================

CREATE TABLE IF NOT EXISTS projects (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(200) NOT NULL,
  description TEXT,
  status      VARCHAR(20)  NOT NULL DEFAULT 'attivo'
              CHECK (status IN ('attivo', 'in_pausa', 'chiuso')),
  owner_id    INTEGER REFERENCES users(id),
  due_date    DATE,
  created_by  INTEGER REFERENCES users(id),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  closed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

-- Un ticket appartiene a 0 o 1 progetto. ON DELETE SET NULL: cancellare un progetto non tocca i ticket.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_project ON tickets(project_id);

-- Attività: legate a un progetto e/o a un ticket, oppure libere (promemoria personali).
CREATE TABLE IF NOT EXISTS project_tasks (
  id            SERIAL PRIMARY KEY,
  project_id    INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  ticket_id     INTEGER REFERENCES tickets(id)  ON DELETE SET NULL,
  title         VARCHAR(300) NOT NULL,
  status        VARCHAR(20)  NOT NULL DEFAULT 'da_fare'
                CHECK (status IN ('da_fare', 'in_corso', 'in_attesa', 'bloccata', 'fatta')),
  status_note   VARCHAR(300),            -- "in attesa di: fornitore X" / "bloccata perché: ..."
  waiting_since TIMESTAMPTZ,             -- da quando è in_attesa (per "da N giorni")
  assigned_to   INTEGER REFERENCES users(id),
  due_date      DATE,
  done_at       TIMESTAMPTZ,
  created_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_tasks_project  ON project_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_assigned ON project_tasks(assigned_to) WHERE status <> 'fatta';

-- Diario del progetto: avanzamenti, problemi, decisioni, note e righe di sistema.
-- visible_to_requester: l'avanzamento compare nella pagina di stato del ticket.
CREATE TABLE IF NOT EXISTS project_log (
  id                   SERIAL PRIMARY KEY,
  project_id           INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id              INTEGER REFERENCES project_tasks(id) ON DELETE SET NULL,
  kind                 VARCHAR(20) NOT NULL
                       CHECK (kind IN ('avanzamento', 'problema', 'decisione', 'nota', 'sistema')),
  body                 TEXT NOT NULL,
  visible_to_requester BOOLEAN NOT NULL DEFAULT FALSE,
  user_id              INTEGER REFERENCES users(id),
  user_name            VARCHAR(100),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_log_project ON project_log(project_id, created_at DESC);

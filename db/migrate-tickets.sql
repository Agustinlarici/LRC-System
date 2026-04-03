-- ============================================================
-- LRC-System — IT Ticket System Migration
-- Run with: psql -U <user> -d <db> -f migrate-tickets.sql
-- Safe to re-run: all statements use IF NOT EXISTS
-- ============================================================

-- ============================================================
-- ENUMS
-- ============================================================

DO $$ BEGIN
  CREATE TYPE ticket_status_enum AS ENUM (
    'aperto', 'in_lavorazione', 'in_attesa', 'risolto', 'chiuso', 'riaperto'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE ticket_priority_enum AS ENUM ('bassa', 'media', 'alta', 'critica');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE ticket_action_enum AS ENUM (
    'creato', 'assegnato', 'stato_cambiato', 'priorita_cambiata',
    'commentato', 'risolto', 'chiuso', 'riaperto', 'allegato_aggiunto'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE user_role_enum AS ENUM ('it', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- USERS (IT technicians)
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id             SERIAL PRIMARY KEY,
  username       VARCHAR(50)  NOT NULL UNIQUE,
  password_hash  TEXT         NOT NULL,
  display_name   VARCHAR(100) NOT NULL,
  email          VARCHAR(150),
  role           user_role_enum NOT NULL DEFAULT 'it',
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TICKET DEPARTMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS ticket_departments (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(100) NOT NULL UNIQUE,
  is_active  BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO ticket_departments (name) VALUES
  ('Produzione'),
  ('Magazzino'),
  ('Ufficio'),
  ('Qualità'),
  ('Manutenzione')
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- TICKET CATEGORIES (with subcategories as JSON or flat table)
-- ============================================================

CREATE TABLE IF NOT EXISTS ticket_categories (
  id            SERIAL PRIMARY KEY,
  category      VARCHAR(100) NOT NULL,
  subcategory   VARCHAR(100),
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  UNIQUE (category, subcategory)
);

INSERT INTO ticket_categories (category, subcategory) VALUES
  ('Hardware', 'PC / Workstation'),
  ('Hardware', 'Stampante'),
  ('Hardware', 'Scanner / Lettore barcode'),
  ('Hardware', 'Monitor'),
  ('Hardware', 'Altro'),
  ('Software', 'Applicativo LRC'),
  ('Software', 'Windows / OS'),
  ('Software', 'Office / Email'),
  ('Software', 'Altro'),
  ('Rete', 'Connessione internet'),
  ('Rete', 'Wi-Fi'),
  ('Rete', 'VPN'),
  ('Rete', 'Altro'),
  ('Account / Accessi', 'Password dimenticata'),
  ('Account / Accessi', 'Nuovo utente'),
  ('Account / Accessi', 'Permessi'),
  ('Altro', NULL)
ON CONFLICT (category, subcategory) DO NOTHING;

-- ============================================================
-- TICKET SLA RULES (response / resolution hours in business time)
-- ============================================================

CREATE TABLE IF NOT EXISTS ticket_sla (
  id               SERIAL PRIMARY KEY,
  priority         ticket_priority_enum NOT NULL UNIQUE,
  response_hours   NUMERIC(5,2) NOT NULL,   -- business hours to first response
  resolution_hours NUMERIC(5,2) NOT NULL    -- business hours to resolution
);

INSERT INTO ticket_sla (priority, response_hours, resolution_hours) VALUES
  ('bassa',   8,  40),
  ('media',   4,  16),
  ('alta',    2,   8),
  ('critica', 1,   4)
ON CONFLICT (priority) DO NOTHING;

-- ============================================================
-- TICKET PRIORITY AUTO-RULES
-- (category + blocca_lavoro → suggested priority)
-- ============================================================

CREATE TABLE IF NOT EXISTS ticket_priority_rules (
  id           SERIAL PRIMARY KEY,
  category     VARCHAR(100) NOT NULL,
  blocca_lavoro BOOLEAN     NOT NULL DEFAULT FALSE,
  priority     ticket_priority_enum NOT NULL,
  UNIQUE (category, blocca_lavoro)
);

INSERT INTO ticket_priority_rules (category, blocca_lavoro, priority) VALUES
  ('Hardware',          TRUE,  'alta'),
  ('Hardware',          FALSE, 'media'),
  ('Software',          TRUE,  'alta'),
  ('Software',          FALSE, 'media'),
  ('Rete',              TRUE,  'critica'),
  ('Rete',              FALSE, 'alta'),
  ('Account / Accessi', TRUE,  'media'),
  ('Account / Accessi', FALSE, 'bassa'),
  ('Altro',             TRUE,  'media'),
  ('Altro',             FALSE, 'bassa')
ON CONFLICT (category, blocca_lavoro) DO NOTHING;

-- ============================================================
-- TICKETS (sequence for #TK-YYYY-NNNN)
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS ticket_yearly_seq START 1;

CREATE TABLE IF NOT EXISTS tickets (
  id                  SERIAL PRIMARY KEY,
  ticket_number       VARCHAR(20)  NOT NULL UNIQUE,  -- #TK-YYYY-NNNN
  year                INTEGER      NOT NULL,
  seq                 INTEGER      NOT NULL,

  -- Caller info (public, no login required)
  caller_name         VARCHAR(100) NOT NULL,
  caller_email        VARCHAR(150),
  caller_phone        VARCHAR(30),
  department_id       INTEGER REFERENCES ticket_departments(id),

  -- Problem description
  title               VARCHAR(200) NOT NULL,
  description         TEXT         NOT NULL,
  category            VARCHAR(100),
  subcategory         VARCHAR(100),
  blocca_lavoro       BOOLEAN      NOT NULL DEFAULT FALSE,

  -- Attachment (one file per ticket for now)
  attachment_path     TEXT,
  attachment_name     VARCHAR(255),

  -- Status & priority
  status              ticket_status_enum   NOT NULL DEFAULT 'aperto',
  priority            ticket_priority_enum NOT NULL DEFAULT 'media',
  assigned_to         INTEGER REFERENCES users(id),

  -- SLA tracking (stored in UTC)
  sla_response_due    TIMESTAMPTZ,
  sla_resolution_due  TIMESTAMPTZ,
  first_response_at   TIMESTAMPTZ,
  resolved_at         TIMESTAMPTZ,
  closed_at           TIMESTAMPTZ,

  -- Resolution
  resolution_note     TEXT,
  reopen_count        INTEGER      NOT NULL DEFAULT 0,

  -- Timestamps
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tickets_status   ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_priority ON tickets(priority);
CREATE INDEX IF NOT EXISTS idx_tickets_year     ON tickets(year);
CREATE INDEX IF NOT EXISTS idx_tickets_assigned ON tickets(assigned_to);

-- ============================================================
-- TICKET HISTORY (full audit trail)
-- ============================================================

CREATE TABLE IF NOT EXISTS ticket_history (
  id                  SERIAL PRIMARY KEY,
  ticket_id           INTEGER      NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  changed_by_user_id  INTEGER      REFERENCES users(id),
  changed_by_name     VARCHAR(100),           -- name at time of change (public caller or IT user)
  action              ticket_action_enum NOT NULL,
  old_value           TEXT,
  new_value           TEXT,
  note                TEXT,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_history_ticket ON ticket_history(ticket_id);

-- ============================================================
-- AUTO-UPDATE updated_at on tickets
-- ============================================================

CREATE OR REPLACE FUNCTION update_tickets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tickets_updated_at ON tickets;
CREATE TRIGGER trg_tickets_updated_at
  BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION update_tickets_updated_at();

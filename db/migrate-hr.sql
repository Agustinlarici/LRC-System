-- ============================================================
-- LRC-System — Modulo HR (Risorse Umane)
-- Run AFTER migrate-auth.sql
-- Safe to re-run: CREATE TABLE IF NOT EXISTS, ADD VALUE IF NOT EXISTS
-- ============================================================

-- 'hr'        → ficha, timeline, organigramma, analisi, evoluzione (dati organizzativi)
-- 'hr_salary' → livello retributivo/stipendio, permesso separato e più ristretto
ALTER TYPE module_key_enum ADD VALUE IF NOT EXISTS 'hr';
ALTER TYPE module_key_enum ADD VALUE IF NOT EXISTS 'hr_salary';

DO $$ BEGIN
  CREATE TYPE hr_employee_status AS ENUM (
    'attivo', 'aspettativa', 'malattia', 'maternita_paternita', 'cessato'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE hr_event_type AS ENUM (
    'assunzione', 'cambio_reparto', 'cambio_ruolo', 'cambio_livello', 'cambio_capo',
    'trasferimento', 'promozione', 'cessazione', 'malattia', 'maternita_paternita',
    'infortunio', 'congedo', 'rientro', 'altro'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Reparti (indipendenti dai ticket_departments, ambito diverso: organico HR) ──

CREATE TABLE IF NOT EXISTS hr_department (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(150) NOT NULL UNIQUE,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Ficha dipendente — situazione attuale ───────────────────────────────────

CREATE TABLE IF NOT EXISTS hr_employee (
  id               SERIAL PRIMARY KEY,
  matricola        VARCHAR(30) UNIQUE,

  -- Dati personali
  nome             VARCHAR(100) NOT NULL,
  cognome          VARCHAR(100) NOT NULL,
  data_nascita     DATE,
  codice_fiscale   VARCHAR(20),
  email            VARCHAR(150),
  telefono         VARCHAR(30),
  indirizzo        VARCHAR(255),

  -- Dati lavorativi (situazione attuale)
  ruolo            VARCHAR(150),
  mansione         VARCHAR(150),
  livello          VARCHAR(30),
  tipo_contratto   VARCHAR(50),
  reparto_id       INTEGER REFERENCES hr_department(id),
  capo_id          INTEGER REFERENCES hr_employee(id),
  user_id          INTEGER REFERENCES users(id),   -- account di sistema collegato (per permessi "capo del proprio team")

  data_assunzione  DATE NOT NULL,
  data_cessazione  DATE,
  stato            hr_employee_status NOT NULL DEFAULT 'attivo',

  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hr_employee_reparto ON hr_employee(reparto_id);
CREATE INDEX IF NOT EXISTS idx_hr_employee_capo    ON hr_employee(capo_id);
CREATE INDEX IF NOT EXISTS idx_hr_employee_stato   ON hr_employee(stato);
CREATE INDEX IF NOT EXISTS idx_hr_employee_user    ON hr_employee(user_id);

-- ─── Timeline — storico eventi (separato dalla situazione attuale) ───────────

CREATE TABLE IF NOT EXISTS hr_employee_event (
  id                 SERIAL PRIMARY KEY,
  employee_id        INTEGER NOT NULL REFERENCES hr_employee(id) ON DELETE CASCADE,
  event_type         hr_event_type NOT NULL,
  event_date         DATE NOT NULL,
  end_date           DATE,             -- per eventi con durata: malattia, congedo, maternità/paternità
  from_value         VARCHAR(255),     -- es. reparto/ruolo/capo precedente
  to_value           VARCHAR(255),     -- es. reparto/ruolo/capo nuovo
  note               TEXT,
  created_by_user_id INTEGER REFERENCES users(id),
  created_by_name    VARCHAR(150),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hr_event_employee ON hr_employee_event(employee_id, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_hr_event_type      ON hr_employee_event(event_type);

-- ─── Storico retributivo — tabella separata, permesso 'hr_salary' a parte ────

CREATE TABLE IF NOT EXISTS hr_employee_salary (
  id                        SERIAL PRIMARY KEY,
  employee_id               INTEGER NOT NULL REFERENCES hr_employee(id) ON DELETE CASCADE,
  data_decorrenza           DATE NOT NULL,
  livello_retributivo       VARCHAR(50),
  retribuzione_annua_lorda  NUMERIC(10,2),
  note                      TEXT,
  created_by_user_id        INTEGER REFERENCES users(id),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hr_salary_employee ON hr_employee_salary(employee_id, data_decorrenza DESC);

-- ─── Alarici — accesso completo (dati organizzativi + retributivi) ───────────

INSERT INTO user_module_permissions (user_id, module_key, can_view, can_manage)
SELECT u.id, 'hr'::module_key_enum, TRUE, TRUE
FROM users u
WHERE u.username = 'Alarici'
ON CONFLICT (user_id, module_key) DO UPDATE SET can_view = TRUE, can_manage = TRUE;

INSERT INTO user_module_permissions (user_id, module_key, can_view, can_manage)
SELECT u.id, 'hr_salary'::module_key_enum, TRUE, TRUE
FROM users u
WHERE u.username = 'Alarici'
ON CONFLICT (user_id, module_key) DO UPDATE SET can_view = TRUE, can_manage = TRUE;

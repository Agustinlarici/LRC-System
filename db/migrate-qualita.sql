-- ============================================================
-- LRC-System — Modulo Qualità (segnalazione difetti su disegno)
-- Run AFTER migrate-auth.sql
-- Safe to re-run: IF NOT EXISTS + ON CONFLICT
-- ============================================================

ALTER TYPE module_key_enum ADD VALUE IF NOT EXISTS 'qualita';

-- ─── Catalogo componenti (immagine di riferimento per pezzo) ──────────────────
CREATE TABLE IF NOT EXISTS qualita_component (
  id                 SERIAL PRIMARY KEY,
  name               VARCHAR(150) NOT NULL,
  code               VARCHAR(50),
  image_path         TEXT NOT NULL,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  created_by_user_id INTEGER REFERENCES users(id),
  created_by_name    VARCHAR(100),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qualita_component_active_sort
  ON qualita_component (is_active, sort_order);

-- ─── Segnalazioni (marcature difetti su un componente/commessa) ───────────────
CREATE TABLE IF NOT EXISTS qualita_report (
  id                 SERIAL PRIMARY KEY,
  component_id       INTEGER NOT NULL REFERENCES qualita_component(id),
  commessa           VARCHAR(100) NOT NULL,
  drawing_path       TEXT NOT NULL,
  defect_type        VARCHAR(100),
  severity           VARCHAR(20) CHECK (severity IS NULL OR severity IN ('bassa', 'media', 'alta')),
  note               TEXT,
  photo_path         TEXT,
  photo_name         TEXT,
  created_by_user_id INTEGER REFERENCES users(id),
  created_by_name    VARCHAR(100),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qualita_report_commessa   ON qualita_report (commessa);
CREATE INDEX IF NOT EXISTS idx_qualita_report_component  ON qualita_report (component_id);
CREATE INDEX IF NOT EXISTS idx_qualita_report_created_at ON qualita_report (created_at DESC);

-- ─── Alarici — accesso completo ────────────────────────────────────────────────
INSERT INTO user_module_permissions (user_id, module_key, can_view, can_manage)
SELECT u.id, 'qualita'::module_key_enum, TRUE, TRUE
FROM users u
WHERE u.username = 'Alarici'
ON CONFLICT (user_id, module_key)
  DO UPDATE SET can_view = TRUE, can_manage = TRUE;

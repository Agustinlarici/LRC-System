-- ============================================================
-- LRC-System — System-wide Auth Migration
-- Run AFTER migrate-tickets.sql
-- Safe to re-run: IF NOT EXISTS + ON CONFLICT DO NOTHING
-- ============================================================

-- ─── Extend role enum ─────────────────────────────────────────────────────────
ALTER TYPE user_role_enum ADD VALUE IF NOT EXISTS 'guest';
ALTER TYPE user_role_enum ADD VALUE IF NOT EXISTS 'operator';

-- ─── Module permission keys ───────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE module_key_enum AS ENUM (
    'ingresso_merci', 'packing', 'monitor', 'buffer',
    'mappa', 'tickets', 'tickets_it', 'tickets_admin', 'impostazioni'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add 'spma' and 'dashboards' to the enum
ALTER TYPE module_key_enum ADD VALUE IF NOT EXISTS 'spma';
ALTER TYPE module_key_enum ADD VALUE IF NOT EXISTS 'dashboards';

-- ─── Per-user module permissions ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_module_permissions (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module_key  module_key_enum NOT NULL,
  can_view    BOOLEAN     NOT NULL DEFAULT FALSE,
  can_manage  BOOLEAN     NOT NULL DEFAULT FALSE,
  UNIQUE (user_id, module_key)
);

CREATE INDEX IF NOT EXISTS idx_ump_user ON user_module_permissions(user_id);

-- ─── Seed users ───────────────────────────────────────────────────────────────
INSERT INTO users (username, password_hash, display_name, role)
VALUES ('Alarici', '$2b$10$JUhkaNVv5S45TuO9HzdCge1Wfyb139niHvJmRJW8N8wPpVziDtGXa', 'Alarici', 'admin')
ON CONFLICT (username) DO NOTHING;

INSERT INTO users (username, password_hash, display_name, role)
VALUES ('guest', '$2b$10$P853gE9ztSGqi21mJy21ZOsSFPeluN4yw8HJf4x3PRBbJsd2qtHbu', 'Ospite', 'guest')
ON CONFLICT (username) DO NOTHING;

-- ─── Guest permissions (view-only, no IT modules) ─────────────────────────────
INSERT INTO user_module_permissions (user_id, module_key, can_view, can_manage)
SELECT u.id, k.key, TRUE, FALSE
FROM users u
CROSS JOIN (VALUES
  ('ingresso_merci'::module_key_enum),
  ('packing'::module_key_enum),
  ('monitor'::module_key_enum),
  ('buffer'::module_key_enum),
  ('mappa'::module_key_enum),
  ('tickets'::module_key_enum),
  ('spma'::module_key_enum)
) AS k(key)
WHERE u.username = 'guest'
ON CONFLICT (user_id, module_key) DO NOTHING;

-- ─── Alarici — full access to everything ──────────────────────────────────────
INSERT INTO user_module_permissions (user_id, module_key, can_view, can_manage)
SELECT u.id, k.key, TRUE, TRUE
FROM users u
CROSS JOIN (VALUES
  ('ingresso_merci'::module_key_enum),
  ('packing'::module_key_enum),
  ('monitor'::module_key_enum),
  ('buffer'::module_key_enum),
  ('mappa'::module_key_enum),
  ('tickets'::module_key_enum),
  ('tickets_it'::module_key_enum),
  ('tickets_admin'::module_key_enum),
  ('impostazioni'::module_key_enum),
  ('spma'::module_key_enum),
  ('dashboards'::module_key_enum)
) AS k(key)
WHERE u.username = 'Alarici'
ON CONFLICT (user_id, module_key)
  DO UPDATE SET can_view = TRUE, can_manage = TRUE;

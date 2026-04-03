-- ─── Add 'dashboards' to module_key_enum ─────────────────────────────────────
ALTER TYPE module_key_enum ADD VALUE IF NOT EXISTS 'dashboards';

-- ─── Grant Alarici access to dashboards ───────────────────────────────────────
INSERT INTO user_module_permissions (user_id, module_key, can_view, can_manage)
SELECT u.id, 'dashboards'::module_key_enum, TRUE, TRUE
FROM users u
WHERE u.username = 'Alarici'
ON CONFLICT (user_id, module_key)
  DO UPDATE SET can_view = TRUE, can_manage = TRUE;

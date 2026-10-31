-- migrate:no-transaction  (ALTER TYPE ... ADD VALUE: il nuovo valore non è usabile nella stessa transazione)
-- Schede Ferrari (validazione Excel con IA locale + VM): permessi del modulo.
--   ferrari_schede      → vedere / operare (caricare, rivedere, correggere)
--   ferrari_supervisore → approvare regole ed esempi proposti, pubblicare conoscenza
ALTER TYPE module_key_enum ADD VALUE IF NOT EXISTS 'ferrari_schede';
ALTER TYPE module_key_enum ADD VALUE IF NOT EXISTS 'ferrari_supervisore';

INSERT INTO user_module_permissions (user_id, module_key, can_view, can_manage)
SELECT u.id, k.module_key::module_key_enum, TRUE, TRUE
FROM users u
CROSS JOIN (VALUES ('ferrari_schede'), ('ferrari_supervisore')) AS k(module_key)
WHERE u.username = 'Alarici'
ON CONFLICT (user_id, module_key)
  DO UPDATE SET can_view = TRUE, can_manage = TRUE;

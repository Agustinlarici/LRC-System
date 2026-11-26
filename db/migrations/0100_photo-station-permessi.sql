-- Photo Station: permesso del modulo (vedere + gestire) per l'utente Alarici, come per le schede Ferrari (0062).
-- Se l'utente non esiste (es. DB di sviluppo) non fa nulla. Gli altri utenti si abilitano da Admin → Sistema.
INSERT INTO user_module_permissions (user_id, module_key, can_view, can_manage)
SELECT u.id, 'photo_station'::module_key_enum, TRUE, TRUE
FROM users u
WHERE u.username = 'Alarici'
ON CONFLICT (user_id, module_key)
  DO UPDATE SET can_view = TRUE, can_manage = TRUE;

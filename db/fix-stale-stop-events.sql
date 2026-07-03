-- ═══════════════════════════════════════════════════════════════════
-- Fix one-off: cierra las fermate auto-detectadas que quedaron
-- "abiertas" (ended_at IS NULL) más allá del fin de su turno.
--
-- Causa: bug en monitor/stop-detector.ts (ya corregido en el código)
-- que dejaba `ended_at = NULL` en la última fermata del día incluso
-- después de terminado el turno, en vez de cerrarla en el horario de
-- fin de turno. Como todos los indicadores calculan la duración como
-- COALESCE(ended_at, NOW()) - started_at, esas fermate acumulaban
-- horas/días de más (incluyendo toda la noche y turnos siguientes).
--
-- Este script es idempotente y seguro de correr más de una vez:
-- solo toca fermate 'auto' que ya terminaron su turno y siguen
-- abiertas. No toca la fermata genuinamente en curso ahora mismo
-- (su turno todavía no llegó a ora_fine).
--
-- Uso (en el servidor de producción, dentro del proyecto):
--   docker compose cp db/fix-stale-stop-events.sql db:/tmp/fix-stale-stop-events.sql
--   docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" -f /tmp/fix-stale-stop-events.sql
--
-- (revisar antes el SELECT de verificación al final: debería listar
-- como máximo la fermata realmente en curso ahora)
-- ═══════════════════════════════════════════════════════════════════

WITH turno_fine AS (
  SELECT linea_id, data, MAX(ora_fine) AS ora_fine
  FROM monitor_turno
  GROUP BY linea_id, data
)
UPDATE monitor_stop_events e
SET ended_at = ((tf.data::text || ' ' || tf.ora_fine)::timestamp AT TIME ZONE 'Europe/Rome')
FROM turno_fine tf
WHERE e.ended_at IS NULL
  AND e.source = 'auto'
  AND tf.linea_id = e.linea_id
  AND tf.data = (e.started_at AT TIME ZONE 'Europe/Rome')::date
  AND ((tf.data::text || ' ' || tf.ora_fine)::timestamp AT TIME ZONE 'Europe/Rome') < NOW()
RETURNING e.id, e.linea_id, e.started_at, e.ended_at,
  ROUND(EXTRACT(EPOCH FROM (e.ended_at - e.started_at)) / 60::numeric, 1) AS minuti_corretti;

-- Verificación: no debería quedar ninguna fermata abierta salvo la
-- que está realmente en curso ahora (su turno de hoy aún no terminó).
SELECT e.id, e.linea_id, l.nome, e.started_at, e.source,
  ROUND(EXTRACT(EPOCH FROM (NOW() - e.started_at)) / 3600::numeric, 1) AS horas_abiertas
FROM monitor_stop_events e
JOIN monitor_linea l ON l.id = e.linea_id
WHERE e.ended_at IS NULL
ORDER BY e.started_at;

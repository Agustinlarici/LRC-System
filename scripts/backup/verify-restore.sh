#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# LRC System — Test di ripristino automatico
#
# Uso:  scripts/backup/verify-restore.sh [cartella-backup]   (default: ultimo)
#
# Ripristina il backup in un container PostgreSQL TEMPORANEO e isolato
# (non tocca la produzione) e controlla che:
#   - i checksum siano validi
#   - pg_restore termini senza errori
#   - il numero di tabelle coincida con il manifest
#   - le tabelle principali contengano dati
# Un backup che non si può ripristinare non è un backup: gira ogni domenica.
# In caso di errore apre un avviso critico in system_alerts.
# ═══════════════════════════════════════════════════════════════════
set -Eeuo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

PG_IMAGE="$(env_get BACKUP_VERIFY_IMAGE postgres:16-alpine)"
SRC="${1:-$(latest_backup)}"
[ -n "$SRC" ] && [ -d "$SRC" ] || die "Nessun backup da verificare"

setup_logging verify
CONTAINER="lrc-restore-test-$$"
STATUS_FILE="$BACKUP_DIR/last-verify.status"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
# Gira anche dentro funzioni con stdout rediretto: per questo scrive su stderr
on_error() {
  trap - ERR
  log "VERIFICA FALLITA per $SRC — comando: $1" >&2
  echo "FAILED $(date -Iseconds) $SRC" > "$STATUS_FILE"
  raise_alert "backup_verify_failed" "Test di ripristino fallito" \
    "Il backup $SRC non si ripristina correttamente. Vedi $BACKUP_DIR/logs."
  cleanup
  exit 1
}
trap 'on_error "$BASH_COMMAND"' ERR
trap cleanup EXIT

log "═══ Test di ripristino: $SRC"
verify_checksums "$SRC"
log "  ✓ checksum OK"

docker run -d --rm --name "$CONTAINER" --network none \
  -e POSTGRES_PASSWORD=verify -e POSTGRES_DB=restore_test "$PG_IMAGE" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$CONTAINER" pg_isready -U postgres -d restore_test -q 2>/dev/null && break
  sleep 1
done
sleep 2   # l'entrypoint riavvia postgres dopo l'init
for _ in $(seq 1 30); do
  docker exec "$CONTAINER" psql -U postgres -d restore_test -qtAc 'SELECT 1' >/dev/null 2>&1 && break
  sleep 1
done

start=$(date +%s)
docker exec -i "$CONTAINER" pg_restore -U postgres -d restore_test --no-owner --exit-on-error < "$SRC/db.dump"
log "  ✓ pg_restore OK in $(( $(date +%s) - start ))s"

q() { docker exec "$CONTAINER" psql -U postgres -d restore_test -v ON_ERROR_STOP=1 -qtAc "$1"; }

tables=$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")
expected=$(grep '^db_tables=' "$SRC/manifest.txt" | cut -d= -f2)
[ "$tables" = "$expected" ] || { log "Tabelle: $tables, attese: $expected"; false; }
log "  ✓ $tables tabelle (come da manifest)"

# Tabelle principali: devono esistere e non essere vuote
for t in $(env_get BACKUP_VERIFY_TABLES "users"); do
  n=$(q "SELECT count(*) FROM \"$t\"")
  [ "$n" -gt 0 ] || { log "Tabella $t vuota"; false; }
  log "  ✓ $t: $n righe"
done

log "  Tabelle più grandi:"
q "SELECT relname || ': ' || n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 5" \
  | sed 's/^/      /'

tar -tzf "$SRC/files.tar.gz" > /dev/null
log "  ✓ files.tar.gz leggibile ($(tar -tzf "$SRC/files.tar.gz" | wc -l) voci)"

echo "OK $(date -Iseconds) $SRC" > "$STATUS_FILE"
resolve_alert "backup_verify_failed" "Test di ripristino OK: $SRC"
log "═══ Verifica completata: il backup è ripristinabile"

#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# LRC System — Ripristino da backup
#
# Uso:
#   scripts/backup/restore.sh latest                 → ultimo backup disponibile
#   scripts/backup/restore.sh /srv/lrc-backups/daily/2026-10-07_0230
#
# Opzioni:
#   --db-only       ripristina solo il database
#   --files-only    ripristina solo i file (allegati, certificati, .env)
#   --no-safety     NON fare il backup di sicurezza prima del ripristino
#   --yes           non chiedere conferma (per uso da script)
#
# Prima di sovrascrivere, salva lo stato attuale in pre-restore/ così il
# ripristino si può annullare. Il backend viene fermato durante l'operazione.
# ═══════════════════════════════════════════════════════════════════
set -Eeuo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

DO_DB=1; DO_FILES=1; SAFETY=1; YES=0; SRC=""
for a in "$@"; do
  case "$a" in
    --db-only)    DO_FILES=0 ;;
    --files-only) DO_DB=0 ;;
    --no-safety)  SAFETY=0 ;;
    --yes)        YES=1 ;;
    -h|--help)    sed -n '2,17p' "$0"; exit 0 ;;
    *)            SRC="$a" ;;
  esac
done
[ -n "$SRC" ] || { sed -n '2,17p' "$0"; exit 1; }
[ "$SRC" = latest ] && SRC="$(latest_backup)"
[ -n "$SRC" ] && [ -d "$SRC" ] || die "Backup non trovato: ${SRC:-<nessuno>}"
SRC="$(realpath "$SRC")"

setup_logging restore
log "═══ Ripristino da $SRC"
sed 's/^/    /' "$SRC/manifest.txt"

verify_checksums "$SRC"
log "  ✓ checksum OK"

if [ "$YES" != 1 ]; then
  echo
  echo "ATTENZIONE: i dati attuali verranno SOSTITUITI con quelli del backup."
  [ "$DO_DB" = 1 ]    && echo "  - database $DB_NAME"
  [ "$DO_FILES" = 1 ] && echo "  - file (allegati ticket, certificati, .env)"
  read -r -p "Scrivi RIPRISTINA per continuare: " answer
  [ "$answer" = RIPRISTINA ] || die "Annullato"
fi


# Il DB serve solo per ripristinarlo o per il backup di sicurezza.
# (Su un server nuovo: prima --files-only per riavere il .env, poi --db-only.)
NEED_DB=0
{ [ "$DO_DB" = 1 ] || [ "$SAFETY" = 1 ]; } && NEED_DB=1

# Lo stesso lock del backup: niente backup da cron durante il ripristino
exec 9>"$BACKUP_DIR/.lock"
flock -n 9 || die "Un backup è in corso: riprovare tra qualche minuto"

BACKEND_STOPPED=0
on_exit() {
  local rc=$?
  if [ "$rc" != 0 ] && [ "$BACKEND_STOPPED" = 1 ]; then
    log "Ripristino interrotto: riavvio il backend (il database di produzione non è stato toccato)"
    dc start backend >/dev/null 2>&1 || true
  fi
}
trap on_exit EXIT

if [ "$NEED_DB" = 1 ]; then
  dc up -d db
  wait_db 90 || die "Database non pronto"
fi

# ─── Backup di sicurezza dello stato attuale ─────────────────────
if [ "$SAFETY" = 1 ]; then
  log "Backup di sicurezza dello stato attuale..."
  if BACKUP_KIND=pre-restore BACKUP_LOCK_HELD=1 "$(dirname "$0")/backup.sh"; then
    log "  ✓ stato attuale salvato in $BACKUP_DIR/pre-restore/"
  else
    die "Backup di sicurezza fallito. Usa --no-safety se il DB attuale è inutilizzabile."
  fi
fi

# ─── Database ────────────────────────────────────────────────────
# Si ripristina in un DB temporaneo; la produzione viene sostituita solo se
# il ripristino è andato a buon fine (scambio di nome, pochi millisecondi).
if [ "$DO_DB" = 1 ]; then
  TMP_DB="${DB_NAME}_restore_tmp"
  OLD_DB="${DB_NAME}_pre_restore"
  psql_admin() { dc exec -T db psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -qtA "$@"; }

  log "Ripristino in database temporaneo $TMP_DB..."
  psql_admin -c "DROP DATABASE IF EXISTS \"$TMP_DB\" WITH (FORCE);" \
             -c "CREATE DATABASE \"$TMP_DB\" OWNER \"$DB_USER\";"
  if ! dc exec -T db pg_restore -U "$DB_USER" -d "$TMP_DB" --no-owner --role="$DB_USER" --exit-on-error \
       < "$SRC/db.dump"; then
    psql_admin -c "DROP DATABASE IF EXISTS \"$TMP_DB\" WITH (FORCE);" || true
    die "pg_restore fallito — il database di produzione NON è stato modificato"
  fi
  tables=$(dc exec -T db psql -U "$DB_USER" -d "$TMP_DB" -qtA -c \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")
  expected=$(grep '^db_tables=' "$SRC/manifest.txt" | cut -d= -f2)
  if [ "$tables" != "$expected" ]; then
    psql_admin -c "DROP DATABASE IF EXISTS \"$TMP_DB\" WITH (FORCE);" || true
    die "Tabelle ripristinate: $tables, attese: $expected — produzione NON modificata"
  fi
  log "  ✓ $tables tabelle ripristinate in $TMP_DB"

  log "Fermo il backend e sostituisco il database..."
  dc stop backend 2>/dev/null || true
  BACKEND_STOPPED=1
  # In una sola transazione: o entrambi i rinomini riescono o nessuno.
  # Il DB attuale resta come $OLD_DB fino al prossimo ripristino.
  psql_admin -c "DROP DATABASE IF EXISTS \"$OLD_DB\" WITH (FORCE);"
  psql_admin -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity
                 WHERE datname IN ('$DB_NAME', '$TMP_DB') AND pid <> pg_backend_pid();" >/dev/null
  psql_admin <<SQL
BEGIN;
DO \$\$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_database WHERE datname = '$DB_NAME') THEN
    EXECUTE 'ALTER DATABASE "$DB_NAME" RENAME TO "$OLD_DB"';
  END IF;
END \$\$;
ALTER DATABASE "$TMP_DB" RENAME TO "$DB_NAME";
COMMIT;
SQL
  log "  ✓ database ripristinato (il precedente è conservato come $OLD_DB)"
fi

# ─── File ────────────────────────────────────────────────────────
if [ "$DO_FILES" = 1 ]; then
  log "Ripristino file..."
  [ -f .env ] && cp -p .env ".env.before-restore-$(date +%Y%m%d%H%M%S)"
  tar -xzpf "$SRC/files.tar.gz" -C /
  log "  ✓ file ripristinati (il .env precedente è in .env.before-restore-*)"
fi

if [ "$NEED_DB" = 1 ] || [ "$BACKEND_STOPPED" = 1 ]; then
  log "Riavvio lo stack..."
  dc up -d
fi
BACKEND_STOPPED=0
log "═══ Ripristino completato da $SRC"

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

# ─── Database pronto (su un server nuovo lo avvia) ───────────────
dc up -d db
wait_db 90 || die "Database non pronto"

# ─── Backup di sicurezza dello stato attuale ─────────────────────
if [ "$SAFETY" = 1 ]; then
  log "Backup di sicurezza dello stato attuale..."
  if BACKUP_KIND=pre-restore "$(dirname "$0")/backup.sh"; then
    log "  ✓ stato attuale salvato in $BACKUP_DIR/pre-restore/"
  else
    die "Backup di sicurezza fallito. Usa --no-safety se il DB attuale è inutilizzabile."
  fi
fi

log "Fermo il backend..."
dc stop backend 2>/dev/null || true

# ─── File ────────────────────────────────────────────────────────
if [ "$DO_FILES" = 1 ]; then
  log "Ripristino file..."
  [ -f .env ] && cp -p .env ".env.before-restore-$(date +%Y%m%d%H%M)"
  tar -xzpf "$SRC/files.tar.gz" -C /
  log "  ✓ file ripristinati (il .env precedente è in .env.before-restore-*)"
  # .env potrebbe essere cambiato: rileggo utente/nome DB
  DB_USER="$(env_get POSTGRES_USER lrc)"; DB_NAME="$(env_get POSTGRES_DB lrc_system)"
fi

# ─── Database ────────────────────────────────────────────────────
if [ "$DO_DB" = 1 ]; then
  log "Ripristino database $DB_NAME..."
  dc exec -T db psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -q \
    -c "DROP DATABASE IF EXISTS \"$DB_NAME\" WITH (FORCE);" \
    -c "CREATE DATABASE \"$DB_NAME\" OWNER \"$DB_USER\";"
  dc exec -T db pg_restore -U "$DB_USER" -d "$DB_NAME" --no-owner --role="$DB_USER" --exit-on-error \
    < "$SRC/db.dump"
  tables=$(psql_db -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")
  expected=$(grep '^db_tables=' "$SRC/manifest.txt" | cut -d= -f2)
  [ "$tables" = "$expected" ] || die "Tabelle ripristinate: $tables, attese: $expected"
  log "  ✓ database ripristinato ($tables tabelle)"
fi

log "Riavvio lo stack..."
dc up -d
log "═══ Ripristino completato da $SRC"

#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# LRC System — Backup completo (database + file)
#
# Uso:
#   scripts/backup/backup.sh                  → backup giornaliero (cron)
#   BACKUP_KIND=manual scripts/backup/backup.sh  → backup manuale
#
# Tipologie (BACKUP_KIND): daily | manual | pre-deploy | pre-restore
#
# Struttura in $BACKUP_DIR (default /srv/lrc-backups):
#   daily/AAAA-MM-GG_HHMMSS/    ← ultimi BACKUP_KEEP_DAILY  (default 7)
#   weekly/…                    ← domenica, ultimi BACKUP_KEEP_WEEKLY  (default 4)
#   monthly/…                   ← giorno 1, ultimi BACKUP_KEEP_MONTHLY (default 12)
#   manual/ pre-deploy/ pre-restore/  ← ultimi BACKUP_KEEP_OTHER (default 5)
#   logs/  last-backup.status
#
# Ogni backup contiene:
#   db.dump        pg_dump formato custom (compresso, ripristinabile con pg_restore)
#   files.tar.gz   allegati ticket, certificati HTTPS, .env, percorsi extra
#   manifest.txt   data, commit git, dimensioni, numero tabelle
#   SHA256SUMS     hash per verificare l'integrità
#
# In caso di errore apre un avviso critico in system_alerts (pagina Sistema).
# ═══════════════════════════════════════════════════════════════════
set -Eeuo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

KIND="${BACKUP_KIND:-daily}"
case "$KIND" in daily|manual|pre-deploy|pre-restore) ;; *) die "BACKUP_KIND non valido: $KIND" ;; esac

KEEP_DAILY="$(env_get BACKUP_KEEP_DAILY 7)"
KEEP_WEEKLY="$(env_get BACKUP_KEEP_WEEKLY 4)"
KEEP_MONTHLY="$(env_get BACKUP_KEEP_MONTHLY 12)"
KEEP_OTHER="$(env_get BACKUP_KEEP_OTHER 5)"
MIN_FREE_MB="$(env_get BACKUP_MIN_FREE_MB 2048)"
TICKETS_HOST="$(env_get TICKETS_UPLOADS_HOST ./data/tickets-uploads)"
EXTRA_PATHS="$(env_get BACKUP_EXTRA_PATHS "")"   # separati da virgola

mkdir -p "$BACKUP_DIR"/{daily,weekly,monthly,manual,pre-deploy,pre-restore}
chmod 700 "$BACKUP_DIR"   # contiene .env e dati personali (HR)
setup_logging backup

# Un solo backup alla volta
exec 9>"$BACKUP_DIR/.lock"
flock -n 9 || die "Un altro backup è già in corso"

STAMP="$(date +%Y-%m-%d_%H%M%S)"
WORK="$BACKUP_DIR/.in-progress-$STAMP"
DEST="$BACKUP_DIR/$KIND/$STAMP"
STATUS_FILE="$BACKUP_DIR/last-backup.status"

# Gira anche dentro funzioni con stdout rediretto: per questo scrive su stderr
on_error() {
  trap - ERR
  local cmd="$1"
  log "BACKUP FALLITO ($KIND) — comando: $cmd" >&2
  rm -rf "$WORK"
  echo "FAILED $(date -Iseconds) $KIND" > "$STATUS_FILE"
  raise_alert "backup_failed" "Backup fallito" \
    "Il backup $KIND del $STAMP è fallito. Vedi $BACKUP_DIR/logs."
  exit 1
}
trap 'on_error "$BASH_COMMAND"' ERR

log "═══ Backup $KIND $STAMP → $DEST"

# ─── Spazio libero ───────────────────────────────────────────────
free_mb=$(df -Pm "$BACKUP_DIR" | awk 'NR==2{print $4}')
last=$(latest_backup || true)
last_mb=0
[ -n "$last" ] && last_mb=$(du -sm "$last" | cut -f1)
need_mb=$(( last_mb * 2 > MIN_FREE_MB ? last_mb * 2 : MIN_FREE_MB ))
if [ "$free_mb" -lt "$need_mb" ]; then
  log "Spazio insufficiente: ${free_mb} MB liberi, servono ${need_mb} MB"
  false
fi

rm -rf "$BACKUP_DIR"/.in-progress-*
mkdir -p "$WORK"

# ─── 1. Database ─────────────────────────────────────────────────
log "Dump database $DB_NAME..."
wait_db 60 || { log "Database non raggiungibile"; false; }
dc exec -T db pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc -Z 6 > "$WORK/db.dump"
[ -s "$WORK/db.dump" ] || { log "db.dump vuoto"; false; }

# Verifica che l'archivio sia leggibile da pg_restore
dc exec -T db pg_restore --list < "$WORK/db.dump" > "$WORK/db.toc"
tables=$(psql_db -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")
pg_version=$(psql_db -c "SHOW server_version")
log "  ✓ db.dump $(du -h "$WORK/db.dump" | cut -f1), $tables tabelle"

# ─── 2. File ─────────────────────────────────────────────────────
log "Archivio file..."
paths=(".env" "certs" "$TICKETS_HOST")
if [ -n "$EXTRA_PATHS" ]; then
  IFS=',' read -r -a extra <<< "$EXTRA_PATHS"
  paths+=("${extra[@]}")
fi
abs_paths=()
for p in "${paths[@]}"; do
  p="$(echo "$p" | sed 's/^ *//;s/ *$//')"
  [ -z "$p" ] && continue
  ap="$(realpath -m "$p")"
  if [ -e "$ap" ]; then
    abs_paths+=("${ap#/}")
    log "  + $ap"
  else
    log "  - $ap (non esiste, saltato)"
  fi
done
# Percorsi assoluti salvati senza "/" iniziale → si ripristinano con tar -C /
tar -czf "$WORK/files.tar.gz" -C / "${abs_paths[@]}"
tar -tzf "$WORK/files.tar.gz" > /dev/null
log "  ✓ files.tar.gz $(du -h "$WORK/files.tar.gz" | cut -f1)"

# ─── 3. Manifest + checksum ──────────────────────────────────────
cat > "$WORK/manifest.txt" <<EOF
kind=$KIND
created=$(date -Iseconds)
host=$(hostname)
lrc_dir=$LRC_DIR
git_commit=$(git rev-parse HEAD 2>/dev/null || echo unknown)
postgres_version=$pg_version
db_name=$DB_NAME
db_user=$DB_USER
db_tables=$tables
db_dump_bytes=$(stat -c %s "$WORK/db.dump")
files_bytes=$(stat -c %s "$WORK/files.tar.gz")
EOF
(cd "$WORK" && sha256sum db.dump files.tar.gz manifest.txt db.toc > SHA256SUMS)
chmod -R go-rwx "$WORK"

# Spostamento atomico: una cartella in $KIND/ è sempre un backup completo
mv "$WORK" "$DEST"

# ─── 4. Copie settimanali / mensili (hard link: non occupano spazio extra) ──
if [ "$KIND" = daily ]; then
  [ "$(date +%u)" = 7 ]  && cp -al "$DEST" "$BACKUP_DIR/weekly/$STAMP"  && log "  ✓ copia settimanale"
  [ "$(date +%d)" = 01 ] && cp -al "$DEST" "$BACKUP_DIR/monthly/$STAMP" && log "  ✓ copia mensile"
fi

# ─── 5. Rotazione ────────────────────────────────────────────────
rotate() {
  local dir="$1" keep="$2"
  find "$dir" -mindepth 1 -maxdepth 1 -type d -name '20*' | sort | head -n -"$keep" | while read -r old; do
    rm -rf "$old" && log "  rimosso $old"
  done
}
rotate "$BACKUP_DIR/daily"   "$KEEP_DAILY"
rotate "$BACKUP_DIR/weekly"  "$KEEP_WEEKLY"
rotate "$BACKUP_DIR/monthly" "$KEEP_MONTHLY"
for k in manual pre-deploy pre-restore; do rotate "$BACKUP_DIR/$k" "$KEEP_OTHER"; done

echo "OK $(date -Iseconds) $KIND $DEST" > "$STATUS_FILE"
resolve_alert "backup_failed" "Backup $KIND completato: $STAMP"
log "═══ Backup completato: $DEST ($(du -sh "$DEST" | cut -f1))"

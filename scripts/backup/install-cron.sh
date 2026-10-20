#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# LRC System — Installa le attività pianificate di backup
#
#   02:30 ogni giorno   → backup.sh          (prima della sync BC delle 03:00)
#   04:30 ogni domenica → verify-restore.sh  (test di ripristino isolato)
#
# Uso:
#   scripts/backup/install-cron.sh        → crontab dell'utente (serve il gruppo docker)
#   sudo scripts/backup/install-cron.sh   → /etc/cron.d (come root)
# Con l'utente normale BACKUP_DIR (in .env) deve essere una cartella sua,
# es. BACKUP_DIR=/home/<utente>/lrc-backups
# Orari personalizzabili: BACKUP_CRON="30 2 * * *" VERIFY_CRON="30 4 * * 0"
# Rieseguibile: sostituisce le righe installate in precedenza.
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

BACKUP_CRON="${BACKUP_CRON:-30 2 * * *}"
VERIFY_CRON="${VERIFY_CRON:-30 4 * * 0}"
CRON_PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

chmod +x "$LRC_DIR"/scripts/backup/*.sh
mkdir -p "$BACKUP_DIR/logs" || die "Impossibile creare $BACKUP_DIR (impostare BACKUP_DIR in .env su una cartella scrivibile)"
chmod 700 "$BACKUP_DIR"
docker info >/dev/null 2>&1 || die "Questo utente non può usare docker: il backup non funzionerebbe"

backup_cmd="\"$LRC_DIR/scripts/backup/backup.sh\" >>\"$BACKUP_DIR/logs/cron.log\" 2>&1"
verify_cmd="\"$LRC_DIR/scripts/backup/verify-restore.sh\" >>\"$BACKUP_DIR/logs/cron.log\" 2>&1"

if [ "$(id -u)" = 0 ]; then
  CRON_FILE=/etc/cron.d/lrc-system-backup
  cat > "$CRON_FILE" <<CRON
# LRC System — backup automatici (generato da scripts/backup/install-cron.sh)
SHELL=/bin/bash
PATH=$CRON_PATH
$BACKUP_CRON root $backup_cmd
$VERIFY_CRON root $verify_cmd
CRON
  chmod 644 "$CRON_FILE"
  log "Installato $CRON_FILE:"; cat "$CRON_FILE"
else
  tag="# lrc-system-backup"
  current="$(crontab -l 2>/dev/null || true)"   # letto prima: le altre righe restano
  { printf '%s\n' "$current" | grep -v -e "$tag" -e '^$' || true
    echo "$BACKUP_CRON PATH=$CRON_PATH bash $backup_cmd $tag"
    echo "$VERIFY_CRON PATH=$CRON_PATH bash $verify_cmd $tag"
  } | crontab - || die "crontab non disponibile per questo utente"
  log "Installato nel crontab di $(id -un):"; crontab -l | grep "$tag"
fi
log "Backup in: $BACKUP_DIR  (log in $BACKUP_DIR/logs)"

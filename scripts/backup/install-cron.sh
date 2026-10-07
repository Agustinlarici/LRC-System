#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# LRC System — Installa le attività pianificate di backup (eseguire come root)
#
#   02:30 ogni giorno   → backup.sh          (prima della sync BC delle 03:00)
#   04:30 ogni domenica → verify-restore.sh  (test di ripristino isolato)
#
# Uso:  sudo scripts/backup/install-cron.sh
# Orari personalizzabili: BACKUP_CRON="30 2 * * *" VERIFY_CRON="30 4 * * 0"
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

[ "$(id -u)" = 0 ] || die "Eseguire come root (sudo)"

BACKUP_CRON="${BACKUP_CRON:-30 2 * * *}"
VERIFY_CRON="${VERIFY_CRON:-30 4 * * 0}"
CRON_FILE=/etc/cron.d/lrc-system-backup

chmod +x "$LRC_DIR"/scripts/backup/*.sh
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

cat > "$CRON_FILE" <<EOF
# LRC System — backup automatici (generato da scripts/backup/install-cron.sh)
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
$BACKUP_CRON root $LRC_DIR/scripts/backup/backup.sh >/dev/null 2>&1
$VERIFY_CRON root $LRC_DIR/scripts/backup/verify-restore.sh >/dev/null 2>&1
EOF
chmod 644 "$CRON_FILE"

log "Installato $CRON_FILE:"
cat "$CRON_FILE"
log "Backup in: $BACKUP_DIR  (log in $BACKUP_DIR/logs)"
log "Consiglio: eseguire subito un primo backup → BACKUP_KIND=manual $LRC_DIR/scripts/backup/backup.sh"

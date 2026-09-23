#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# LRC-System — Aggiornamento automatico del sistema operativo (Ubuntu)
#
# Pipeline: pre-check → dry-run log → backup → apt upgrade → healthcheck
#           → rollback pacchetti se fallisce → reboot condizionato → pulizia
#
# Va installato sul SERVER Ubuntu (non dentro l'app). Vedi README.md
# in questa cartella per l'installazione.
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

CONFIG_FILE="/etc/default/auto-update"
[[ -f "$CONFIG_FILE" ]] && source "$CONFIG_FILE"

UPDATE_MODE="${UPDATE_MODE:-security}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/auto-update}"
LOG_DIR="${LOG_DIR:-/var/log/auto-update}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
MIN_FREE_DISK_PERCENT="${MIN_FREE_DISK_PERCENT:-15}"
CRITICAL_SERVICES="${CRITICAL_SERVICES:-docker ssh}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-}"

DATE_TAG="$(date +%F_%H%M%S)"
mkdir -p "$BACKUP_DIR" "$LOG_DIR"
LOGFILE="$LOG_DIR/update-$DATE_TAG.log"
exec > >(tee -a "$LOGFILE") 2>&1

log()  { echo "[$(date '+%F %T')] $*"; }
fail() { log "ERRORE: $*"; exit 1; }

log "═══ Avvio aggiornamento automatico (modalità: $UPDATE_MODE) ═══"

# ── 1. PRE-CHECK ─────────────────────────────────────────────────────
log "1/7 Pre-check..."

free_percent=$(df --output=pcent / | tail -1 | tr -dc '0-9')
free_avail=$((100 - free_percent))
if (( free_avail < MIN_FREE_DISK_PERCENT )); then
  fail "Spazio libero su / insufficiente ($free_avail% < $MIN_FREE_DISK_PERCENT%). Abortito senza toccare nulla."
fi
log "  Spazio libero su /: ${free_avail}% — OK"

for svc in $CRITICAL_SERVICES; do
  if ! systemctl is-active --quiet "$svc"; then
    fail "Il servizio '$svc' non è attivo PRIMA dell'update. Risolvere manualmente prima di procedere."
  fi
done
log "  Servizi critici già attivi: OK"

# ── 2. DRY-RUN (log di cosa verrebbe aggiornato) ────────────────────
log "2/7 Dry-run (solo log, nessuna modifica)..."
apt-get update -qq
apt-get -s upgrade | tee "$LOG_DIR/dry-run-$DATE_TAG.log" | grep -E '^Inst|^Conf' || log "  Nessun pacchetto da aggiornare."

# ── 3. BACKUP ─────────────────────────────────────────────────────────
log "3/7 Backup di /etc e lista pacchetti..."
tar czf "$BACKUP_DIR/etc-$DATE_TAG.tar.gz" -C / etc
dpkg-query -W -f='${Package}=${Version}\n' > "$BACKUP_DIR/pkgs-versions-$DATE_TAG.txt"
log "  Backup salvato in $BACKUP_DIR (etc-$DATE_TAG.tar.gz, pkgs-versions-$DATE_TAG.txt)"

# Teniamo i .deb scaricati per poter fare downgrade in caso di rollback
echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' > /etc/apt/apt.conf.d/99-keep-debs

# ── 4. APPLICA AGGIORNAMENTI ─────────────────────────────────────────
log "4/7 Applico aggiornamenti (modalità: $UPDATE_MODE)..."
export DEBIAN_FRONTEND=noninteractive

if [[ "$UPDATE_MODE" == "security" ]]; then
  if ! command -v unattended-upgrade &>/dev/null; then
    fail "unattended-upgrades non installato. Eseguire: apt-get install unattended-upgrades"
  fi
  unattended-upgrade -v
else
  apt-get -y full-upgrade
fi

REBOOT_NEEDED=false
[[ -f /var/run/reboot-required ]] && REBOOT_NEEDED=true

# ── 5. HEALTHCHECK ────────────────────────────────────────────────────
log "5/7 Healthcheck post-update..."
HEALTH_OK=true

for svc in $CRITICAL_SERVICES; do
  if ! systemctl is-active --quiet "$svc"; then
    log "  ✗ Servizio '$svc' non attivo dopo l'update."
    HEALTH_OK=false
  fi
done

if [[ -n "$HEALTHCHECK_URL" ]]; then
  if ! curl -fsS --max-time 10 "$HEALTHCHECK_URL" > /dev/null; then
    log "  ✗ Healthcheck HTTP fallito: $HEALTHCHECK_URL"
    HEALTH_OK=false
  else
    log "  ✓ Healthcheck HTTP OK: $HEALTHCHECK_URL"
  fi
fi

# ── 6. ROLLBACK SE NECESSARIO ─────────────────────────────────────────
if [[ "$HEALTH_OK" != "true" ]]; then
  log "6/7 Healthcheck fallito → eseguo rollback pacchetti..."
  bash "$(dirname "$0")/rollback.sh" "$BACKUP_DIR/pkgs-versions-$DATE_TAG.txt"
  log "  Rollback completato. NESSUN reboot verrà eseguito. Controllare manualmente $LOGFILE."
  exit 1
else
  log "6/7 Healthcheck OK, nessun rollback necessario."
fi

# ── 7. REBOOT CONDIZIONATO + PULIZIA ──────────────────────────────────
log "7/7 Pulizia backup/log più vecchi di $RETENTION_DAYS giorni..."
find "$BACKUP_DIR" -type f -mtime "+$RETENTION_DAYS" -delete
find "$LOG_DIR" -type f -mtime "+$RETENTION_DAYS" -delete

if [[ "$REBOOT_NEEDED" == "true" ]]; then
  log "Riavvio richiesto dal sistema (es. nuovo kernel). Riavvio tra 1 minuto..."
  log "═══ Aggiornamento completato con successo — REBOOT in corso ═══"
  shutdown -r +1 "Riavvio automatico post-aggiornamenti di sicurezza (LRC-System auto-update)"
else
  log "═══ Aggiornamento completato con successo — nessun reboot necessario ═══"
fi

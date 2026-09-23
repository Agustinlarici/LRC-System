#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# LRC-System — Rollback pacchetti dopo un update fallito
#
# Uso:
#   bash rollback.sh /var/backups/auto-update/pkgs-versions-<data>.txt
#   bash rollback.sh                # usa il backup pkgs-versions più recente
#
# Nota: senza uno snapshot di disco (LVM/Btrfs/cloud) non è possibile un
# rollback 100% garantito. Questo script reinstalla le versioni esatte dei
# pacchetti precedenti usando i .deb tenuti in cache (Keep-Downloaded-Packages).
# Se un .deb non è più in cache, apt prova a riscaricarlo dai repository
# (se ancora disponibile). Il backup di /etc resta disponibile per un
# ripristino manuale più approfondito, se necessario.
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

CONFIG_FILE="/etc/default/auto-update"
[[ -f "$CONFIG_FILE" ]] && source "$CONFIG_FILE"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/auto-update}"
LOG_DIR="${LOG_DIR:-/var/log/auto-update}"

log() { echo "[$(date '+%F %T')] [ROLLBACK] $*"; }

PKGS_FILE="${1:-}"
if [[ -z "$PKGS_FILE" ]]; then
  PKGS_FILE="$(ls -t "$BACKUP_DIR"/pkgs-versions-*.txt 2>/dev/null | head -1 || true)"
fi

[[ -z "$PKGS_FILE" || ! -f "$PKGS_FILE" ]] && { log "ERRORE: nessun file di versioni pacchetti trovato."; exit 1; }

log "Ripristino versioni pacchetti da: $PKGS_FILE"

export DEBIAN_FRONTEND=noninteractive
FAILED=0

while IFS= read -r line; do
  pkg="${line%%=*}"
  ver="${line#*=}"
  current_ver="$(dpkg-query -W -f='${Version}' "$pkg" 2>/dev/null || echo "")"
  if [[ "$current_ver" == "$ver" ]]; then
    continue
  fi
  log "Downgrade $pkg: $current_ver → $ver"
  if ! apt-get install -y --allow-downgrades "${pkg}=${ver}" 2>>"$LOG_DIR/rollback-errors.log"; then
    log "  ✗ Non riuscito a ripristinare $pkg=$ver (vedi $LOG_DIR/rollback-errors.log)"
    FAILED=$((FAILED+1))
  fi
done < "$PKGS_FILE"

if (( FAILED > 0 )); then
  log "Rollback completato con $FAILED pacchetti non ripristinabili automaticamente. Intervento manuale richiesto."
  exit 1
fi

log "Rollback pacchetti completato con successo."

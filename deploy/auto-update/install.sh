#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# LRC-System — Installer del sistema di aggiornamento automatico
#
# Da eseguire come root SUL SERVER Ubuntu (non dentro il repo/app).
# Uso:
#   sudo bash install.sh
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

[[ "$EUID" -ne 0 ]] && { echo "Eseguire come root (sudo bash install.sh)"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="/usr/local/bin/auto-update"

echo "==> Installo unattended-upgrades (se manca)..."
apt-get update -qq
apt-get install -y unattended-upgrades

echo "==> Copio gli script in $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
install -m 755 "$SCRIPT_DIR/update-system.sh" "$INSTALL_DIR/update-system.sh"
install -m 755 "$SCRIPT_DIR/rollback.sh"      "$INSTALL_DIR/rollback.sh"

echo "==> Copio la configurazione in /etc/default/auto-update (non sovrascrivo se esiste già)..."
if [[ -f /etc/default/auto-update ]]; then
  echo "    /etc/default/auto-update esiste già, non lo tocco. Confronta a mano con $SCRIPT_DIR/auto-update.env"
else
  install -m 644 "$SCRIPT_DIR/auto-update.env" /etc/default/auto-update
fi

echo "==> Installo unit systemd..."
install -m 644 "$SCRIPT_DIR/auto-update.service" /etc/systemd/system/auto-update.service
install -m 644 "$SCRIPT_DIR/auto-update.timer"   /etc/systemd/system/auto-update.timer

mkdir -p /var/backups/auto-update /var/log/auto-update

echo "==> Attivo il timer..."
systemctl daemon-reload
systemctl enable --now auto-update.timer

echo ""
echo "Installazione completata."
echo ""
echo "  Config:        /etc/default/auto-update"
echo "  Stato timer:   systemctl status auto-update.timer"
echo "  Prossimo giro: systemctl list-timers auto-update.timer"
echo "  Log:           /var/log/auto-update/"
echo "  Backup:        /var/backups/auto-update/"
echo ""
echo "  Test manuale (senza aspettare le 03:00):"
echo "    sudo systemctl start auto-update.service"
echo "    sudo journalctl -u auto-update.service -f"

#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# LRC System — funzioni comuni per backup / restore / verifica
# Da includere con: source "$(dirname "$0")/lib.sh"
# ═══════════════════════════════════════════════════════════════════

# Cartella del repo (dove stanno docker-compose.yml e .env)
LRC_DIR="${LRC_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$LRC_DIR" || exit 1

# Legge una variabile da .env senza fare "source" (i valori possono contenere
# spazi o backslash, es. percorsi UNC). Priorità: variabile d'ambiente → .env → default.
env_get() {
  local key="$1" default="${2:-}" val=""
  if [ -n "${!key:-}" ]; then
    printf '%s' "${!key}"; return
  fi
  if [ -f .env ]; then
    val="$( { grep -E "^${key}=" .env || true; } | tail -n1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//' -e 's/\r$//')"
  fi
  printf '%s' "${val:-$default}"
}

DB_USER="$(env_get POSTGRES_USER lrc)"
DB_NAME="$(env_get POSTGRES_DB lrc_system)"
BACKUP_DIR="$(env_get BACKUP_DIR /srv/lrc-backups)"

ts()   { date '+%Y-%m-%d %H:%M:%S'; }
log()  { echo "[$(ts)] $*"; }
die()  { log "ERRORE: $*"; exit 1; }

# Scrive tutto l'output anche in $BACKUP_DIR/logs/<nome>-AAAA-MM.log
setup_logging() {
  local name="$1"
  mkdir -p "$BACKUP_DIR/logs"
  exec > >(tee -a "$BACKUP_DIR/logs/${name}-$(date +%Y-%m).log") 2>&1
  # Log più vecchi di ~13 mesi
  find "$BACKUP_DIR/logs" -name '*.log' -mtime +400 -delete 2>/dev/null || true
}

dc()   { docker compose "$@"; }
psql_db() { dc exec -T db psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -qtA "$@"; }

wait_db() {
  local timeout="${1:-60}" elapsed=0
  until dc exec -T db pg_isready -U "$DB_USER" -d postgres -q 2>/dev/null; do
    sleep 2; elapsed=$((elapsed+2))
    [ "$elapsed" -ge "$timeout" ] && return 1
  done
}

# Apre/chiude un avviso in system_alerts (visibile nella pagina Sistema).
# Non deve mai far fallire lo script chiamante.
raise_alert() {
  local key="$1" title="$2" msg="${3//\'/\'\'}"
  psql_db -c "INSERT INTO system_alerts (alert_key, severity, title, message)
              SELECT '$key', 'critical', '$title', '$msg'
              WHERE NOT EXISTS (SELECT 1 FROM system_alerts WHERE alert_key='$key' AND resolved_at IS NULL);" \
    >/dev/null 2>&1 || log "ATTENZIONE: impossibile registrare l'avviso nel DB"
}

resolve_alert() {
  local key="$1" msg="${2//\'/\'\'}"
  psql_db -c "UPDATE system_alerts SET resolved_at=NOW(), resolved_message='$msg'
              WHERE alert_key='$key' AND resolved_at IS NULL;" >/dev/null 2>&1 || true
}

# Ultimo backup completo (cartella) tra tutte le tipologie
latest_backup() {
  find "$BACKUP_DIR"/{daily,pre-deploy,pre-restore,manual} -mindepth 1 -maxdepth 1 -type d \
       -name '20*' 2>/dev/null | awk -F/ '{print $NF"\t"$0}' | sort | tail -n1 | cut -f2
}

# Controlla gli hash SHA256 di una cartella di backup
verify_checksums() {
  local dir="$1"
  [ -f "$dir/SHA256SUMS" ] || die "SHA256SUMS mancante in $dir"
  (cd "$dir" && sha256sum --quiet -c SHA256SUMS) || die "Checksum NON validi in $dir (backup corrotto)"
}

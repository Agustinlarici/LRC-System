#!/usr/bin/env bash
# ─── LRC-System — Security & Updates Report ──────────────────────────────────
# Usage: bash check-updates.sh
# Requires: node/npm, docker (optional)

set -euo pipefail

REPORT_FILE="security-report-$(date +%Y-%m-%d).txt"

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

log()     { echo -e "$*"; }
section() { log "\n${BOLD}${BLUE}══════════════════════════════════════════${NC}"; log "${BOLD}${BLUE}  $*${NC}"; log "${BOLD}${BLUE}══════════════════════════════════════════${NC}"; }

# ─── npm audit ────────────────────────────────────────────────────────────────

run_audit() {
  local dir=$1
  local label=$2
  log "\n${BOLD}▶ npm audit — $label${NC}"
  cd "$dir"

  local audit_out
  audit_out=$(npm audit --json 2>/dev/null || true)

  local vuln_count critical high moderate low
  vuln_count=$(echo "$audit_out" | node -e "
    let raw = '';
    process.stdin.on('data', d => raw += d);
    process.stdin.on('end', () => {
      try {
        const d = JSON.parse(raw);
        const v = d.metadata?.vulnerabilities ?? {};
        console.log([v.critical??0, v.high??0, v.moderate??0, v.low??0].join(','));
      } catch { console.log('0,0,0,0'); }
    });
  " 2>/dev/null || echo "0,0,0,0")

  IFS=',' read -r critical high moderate low <<< "$vuln_count"

  [[ "$critical" -gt 0 ]] && log "  ${RED}Critico  : $critical${NC}" || log "  ${GREEN}Critico  : 0${NC}"
  [[ "$high"     -gt 0 ]] && log "  ${RED}Alto     : $high${NC}"     || log "  ${GREEN}Alto     : 0${NC}"
  [[ "$moderate" -gt 0 ]] && log "  ${YELLOW}Moderato : $moderate${NC}" || log "  ${GREEN}Moderato : 0${NC}"
  log "  Basso    : $low"

  if [[ "$critical" -gt 0 || "$high" -gt 0 ]]; then
    log "\n  ${RED}⚠ Dettaglio (critiche/alte):${NC}"
    npm audit --audit-level=high 2>/dev/null | grep -v "^npm" | grep -v "^$" | command head -40 || true
  fi

  cd - > /dev/null
}

# ─── npm outdated ─────────────────────────────────────────────────────────────

run_outdated() {
  local dir=$1
  local label=$2
  log "\n${BOLD}▶ Pacchetti outdated — $label${NC}"
  cd "$dir"

  local out
  out=$(npm outdated --json 2>/dev/null || true)

  if [[ -z "$out" || "$out" == "{}" ]]; then
    log "  ${GREEN}Tutti i pacchetti sono aggiornati.${NC}"
  else
    echo "$out" | node -e "
      let raw = '';
      process.stdin.on('data', d => raw += d);
      process.stdin.on('end', () => {
        try {
          const d = JSON.parse(raw);
          const rows = Object.entries(d).map(([name, v]) => ({
            name,
            current: v.current ?? '-',
            wanted:  v.wanted  ?? '-',
            latest:  v.latest  ?? '-',
            type:    v.type    ?? '',
          }));
          rows.sort((a,b) => (a.type === 'dependencies' ? -1 : 1));
          const pad = (s, n) => String(s).padEnd(n);
          console.log('  ' + pad('Pacchetto',35) + pad('Attuale',12) + pad('Richiesto',12) + pad('Ultimo',12) + 'Tipo');
          console.log('  ' + '-'.repeat(75));
          rows.forEach(r => console.log('  ' + pad(r.name,35) + pad(r.current,12) + pad(r.wanted,12) + pad(r.latest,12) + r.type));
          console.log('\n  Totale da aggiornare: ' + rows.length);
        } catch(e) { console.log('  (errore parsing: ' + e.message + ')'); }
      });
    " 2>/dev/null || echo "  (errore)"
  fi

  cd - > /dev/null
}

# ─── Docker version ───────────────────────────────────────────────────────────

check_docker_version() {
  log "\n${BOLD}▶ Versione Docker${NC}"

  if ! command -v docker &>/dev/null; then
    log "  ${YELLOW}⚠ docker non trovato nel PATH${NC}"
    return
  fi

  local client_ver
  client_ver=$(docker version --format '{{.Client.Version}}' 2>/dev/null || echo "")
  log "  Client          : ${client_ver:-N/A}"

  local server_ver
  server_ver=$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo "")

  if [[ -z "$server_ver" ]]; then
    log "  Engine (server) : ${YELLOW}N/A — Docker Desktop non avviato${NC}"
    log "  ${YELLOW}⚠ Avviare Docker Desktop per vedere la versione del server${NC}"
  else
    log "  Engine (server) : $server_ver"
    local engine_major
    engine_major=$(echo "$server_ver" | grep -oE '^[0-9]+' || echo "0")
    if [[ "$engine_major" -lt 25 ]]; then
      log "  ${RED}⚠ Versione molto vecchia — aggiornare subito${NC}"
    elif [[ "$engine_major" -lt 27 ]]; then
      log "  ${YELLOW}⚠ Disponibile versione 27.x (stabile attuale)${NC}"
    else
      log "  ${GREEN}Versione recente${NC}"
    fi
  fi

  # Docker Desktop version from Windows registry
  if command -v powershell.exe &>/dev/null; then
    local dd_ver
    dd_ver=$(powershell.exe -NoProfile -Command \
      "(Get-ItemProperty 'HKLM:\SOFTWARE\Docker Inc.\Docker Desktop' -ErrorAction SilentlyContinue).Version" \
      2>/dev/null | tr -d '\r\n ' || echo "")
    if [[ -n "$dd_ver" ]]; then
      log "  Docker Desktop  : $dd_ver"
    fi
  fi

  log ""
  log "  Come aggiornare: Docker Desktop → Help → Check for Updates"
  log "  Changelog: https://docs.docker.com/desktop/release-notes/"
}

# ─── Docker images ────────────────────────────────────────────────────────────

check_docker_images() {
  log "\n${BOLD}▶ Immagini Docker (docker-compose.yml)${NC}"

  local compose_file="$ROOT/docker-compose.yml"
  if [[ ! -f "$compose_file" ]]; then
    log "  docker-compose.yml non trovato"
    return
  fi

  local images
  images=$(grep -E '^\s+image:' "$compose_file" | awk '{print $2}' | sort -u)

  printf "  %-42s %-16s %s\n" "Immagine" "Tag" "Note"
  printf "  %s\n" "$(printf '%.0s-' {1..72})"

  while IFS= read -r img; do
    local tag name note
    name="${img%%:*}"
    tag="${img##*:}"
    [[ "$tag" == "$name" ]] && tag="latest"

    if [[ "$tag" == "latest" ]]; then
      note="⚠ tag non fissato"
    elif [[ "$tag" =~ alpine ]]; then
      note="OK (alpine)"
    else
      note="OK"
    fi
    printf "  %-42s %-16s %s\n" "$img" "$tag" "$note"
  done <<< "$images"
}

# ─── Node version ─────────────────────────────────────────────────────────────

check_node_version() {
  log "\n${BOLD}▶ Versione Node.js${NC}"

  local node_ver dockerfile_ver lts_major=22
  node_ver=$(node --version 2>/dev/null || echo "N/A")

  # Use grep + command head to avoid shadowing
  dockerfile_ver=$(grep -oE 'node:[0-9]+' "$ROOT/backend/Dockerfile" 2>/dev/null \
    | command head -1 | cut -d: -f2 || echo "?")

  log "  Locale       : $node_ver"
  log "  Dockerfile   : node:${dockerfile_ver}-alpine"

  local current_major
  current_major=$(echo "$node_ver" | grep -oE '[0-9]+' | command head -1 || echo "0")

  if [[ "$dockerfile_ver" == "?" ]]; then
    log "  ${YELLOW}⚠ Impossibile leggere la versione dal Dockerfile${NC}"
  elif [[ "$dockerfile_ver" -lt "$lts_major" ]]; then
    log "  ${YELLOW}⚠ Dockerfile usa node:$dockerfile_ver — LTS attuale è $lts_major (considera di aggiornare)${NC}"
  else
    log "  ${GREEN}node:$dockerfile_ver — LTS attuale${NC}"
  fi
}

# ─── Main ─────────────────────────────────────────────────────────────────────

ROOT="$(cd "$(dirname "$0")" && pwd)"

{

log "${BOLD}"
log "╔══════════════════════════════════════════════════╗"
log "║       LRC-System — Security & Update Report      ║"
log "║       $(date '+%Y-%m-%d %H:%M:%S')                        ║"
log "╚══════════════════════════════════════════════════╝"
log "${NC}"

check_node_version
check_docker_version

section "BACKEND (Node.js / Hono)"
run_audit    "$ROOT/backend"  "backend"
run_outdated "$ROOT/backend"  "backend"

section "FRONTEND (Next.js / React)"
run_audit    "$ROOT/frontend" "frontend"
run_outdated "$ROOT/frontend" "frontend"

section "DOCKER IMAGES"
check_docker_images

section "RIEPILOGO AZIONI CONSIGLIATE"
log "  1. Vulnerabilità npm → cd backend && npm audit fix"
log "                         cd frontend && npm audit fix"
log ""
log "  2. Pacchetti outdated → npm update (patch/minor)"
log "     Major: npx npm-check-updates -u && npm install"
log ""
log "  3. Node Dockerfile: node:20-alpine → node:22-alpine (LTS attuale)"
log "     Modifica: backend/Dockerfile e frontend/Dockerfile"
log ""
log "  4. Docker Desktop → Help → Check for Updates"
log "     Changelog: https://docs.docker.com/desktop/release-notes/"
log ""
log "  5. postgres:16-alpine → supportato fino al 2028, OK per ora"
log ""
log "  6. adminer senza tag fisso → considera adminer:4"
log ""
log "  Report: ${BOLD}$REPORT_FILE${NC}"

} 2>&1 | tee "$REPORT_FILE"

echo ""
echo "Fatto. Report salvato: $REPORT_FILE"

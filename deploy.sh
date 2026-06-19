#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# LRC System — Script di deploy produzione
#
# Uso:
#   ./deploy.sh            → primo avvio o deploy completo (build + swap)
#   ./deploy.sh update     → aggiornamento zero-downtime (pull + migrate + build + swap)
#   ./deploy.sh migrate    → solo migrazioni DB (stack in running)
#   ./deploy.sh stop       → ferma lo stack
#   ./deploy.sh restart    → riavvia senza rebuild
#   ./deploy.sh logs       → log live
# ═══════════════════════════════════════════════════════════════════
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${GREEN}[LRC]${NC} $1"; }
step()  { echo -e "${CYAN}[LRC]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

CMD="${1:-up}"

# ─── Comandi semplici ─────────────────────────────────────────────
case "$CMD" in
  stop)
    info "Fermo lo stack..."
    docker compose down
    info "Stack fermato."
    exit 0
    ;;
  logs)
    docker compose logs -f
    exit 0
    ;;
  restart)
    info "Riavvio i container (senza rebuild)..."
    docker compose restart
    info "Riavviato."
    exit 0
    ;;
  up|update|migrate) ;;
  *) error "Comando sconosciuto: $CMD. Usa: up | update | migrate | stop | restart | logs" ;;
esac

# ─── Controllo .env ───────────────────────────────────────────────
if [ ! -f .env ]; then
  error "File .env non trovato!\nCopia .env.example → .env e compila le variabili."
fi

required_vars=(POSTGRES_PASSWORD NEXT_PUBLIC_API_URL CORS_ORIGINS BC_USER BC_PASSWORD)
missing=0
for var in "${required_vars[@]}"; do
  val=$(grep -E "^${var}=" .env | cut -d= -f2-)
  if [ -z "$val" ]; then
    warn "Variabile mancante o vuota nel .env: ${var}"
    missing=1
  fi
done
[ "$missing" -eq 1 ] && error "Compila le variabili obbligatorie nel .env prima di continuare."

DB_USER="$(grep POSTGRES_USER .env | cut -d= -f2)"
DB_NAME="$(grep POSTGRES_DB .env   | cut -d= -f2)"
DB_NAME="${DB_NAME:-lrc_system}"

# ─── Cartelle necessarie ──────────────────────────────────────────
SCAN_HOST="${SCAN_FOLDER_HOST:-./test-scansioni}"
DOCS_HOST="${DOCS_FOLDER_HOST:-./test-documentos}"
mkdir -p "$SCAN_HOST" "$DOCS_HOST"

# ═══════════════════════════════════════════════════════════════════
# Funzione: applica le migrazioni (stack deve essere running)
# ═══════════════════════════════════════════════════════════════════
run_migrations() {
  step "Applico le migrazioni al database..."

  # Attendo che il DB sia pronto
  timeout=60; elapsed=0
  while ! docker compose exec db pg_isready -U "$DB_USER" -d "$DB_NAME" -q 2>/dev/null; do
    sleep 2; elapsed=$((elapsed+2))
    [ $elapsed -ge $timeout ] && error "Database non pronto dopo ${timeout}s."
  done

  MIGRATIONS=(
    "db/migrate.sql"
    "db/migrate-tickets.sql"
    "db/migrate-auth.sql"
    "db/migrate-heatmap.sql"
    "db/migrate-heatmap-hourly.sql"
    "db/migrate-dashboards.sql"
    "db/migrate-webthron-cache.sql"
    "db/migrate-system-config.sql"
    "db/migrate-impostazioni.sql"
    "db/migrate-unified-sync.sql"
    "db/migrate-alerts.sql"
    "db/migrate-resumen.sql"
    "db/migrate-spma.sql"
    "db/migrate-spma-import-log.sql"
    "db/migrate-spma-alerts.sql"
    "db/migrate-spma-telegram.sql"
    "db/migrate-spma-email.sql"
    "db/migrate-spma-onedrive.sql"
    "db/migrate-iknow-tracking.sql"
    "db/migrate-lead-time.sql"
    "db/migrate-recepciones.sql"
    "db/migrate-edi.sql"
    "db/migrate-edi-rename-supplier-code.sql"
    "db/migrate-edi-establishment-generic.sql"
    "db/migrate-edi-auto-generate.sql"
    "db/migrate-audit-log.sql"
    "db/migrate-monitor-stops.sql"
    "db/migrate-edi-ferrari-delins.sql"
  )
  for f in "${MIGRATIONS[@]}"; do
    if [ -f "$f" ]; then
      docker compose cp "$f" "db:/tmp/$(basename "$f")"
      docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" -q -f "/tmp/$(basename "$f")"
      info "  ✓ $(basename "$f")"
    fi
  done
  info "Migrazioni completate."
}

# ═══════════════════════════════════════════════════════════════════
# migrate — solo migrazioni, stack già running
# ═══════════════════════════════════════════════════════════════════
if [ "$CMD" = "migrate" ]; then
  run_migrations
  exit 0
fi

# ═══════════════════════════════════════════════════════════════════
# update — zero-downtime: pull → migrate → build → swap
# ═══════════════════════════════════════════════════════════════════
if [ "$CMD" = "update" ]; then
  step "1/4  Git pull..."
  git pull

  step "2/4  Migrazioni DB (stack in running — nessun downtime)..."
  run_migrations

  step "3/4  Build nuove immagini in background (nessun downtime)..."
  docker compose build --no-cache

  step "4/4  Swap container (~5 secondi di interruzione)..."
  docker compose up -d

  info "Aggiornamento completato."
  echo ""
  echo "  Frontend  →  http://$(grep NEXT_PUBLIC_API_URL .env | cut -d= -f2- | sed 's/:3001//' | sed 's|http://||'):3000"
  echo "  Log live  →  ./deploy.sh logs"
  exit 0
fi

# ═══════════════════════════════════════════════════════════════════
# up — primo avvio o deploy completo
# ═══════════════════════════════════════════════════════════════════
step "Avvio stack LRC System..."
docker compose up --build -d

run_migrations

info "Stack avviato con successo!"
echo ""
echo "  Frontend  →  http://$(grep NEXT_PUBLIC_API_URL .env | cut -d= -f2- | sed 's/:3001//' | sed 's|http://||'):3000"
echo "  Backend   →  $(grep NEXT_PUBLIC_API_URL .env | cut -d= -f2-)/health"
echo ""
echo "  Log live  →  ./deploy.sh logs"
echo "  Stop      →  ./deploy.sh stop"
echo "  Update    →  ./deploy.sh update"

#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# LRC System — Script di deploy produzione
# Uso: ./deploy.sh           → avvia / aggiorna lo stack
#      ./deploy.sh stop      → ferma lo stack
#      ./deploy.sh logs      → mostra i log live
#      ./deploy.sh restart   → riavvia senza rebuild
# ═══════════════════════════════════════════════════════════════════
set -e

# ─── Colori ───────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[LRC]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

CMD="${1:-up}"

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
  up) ;;
  *) error "Comando sconosciuto: $CMD. Usa: up | stop | logs | restart" ;;
esac

# ─── Controllo .env ───────────────────────────────────────────────
if [ ! -f .env ]; then
  error "File .env non trovato!\nCopia .env.example → .env e compila le variabili."
fi

# Variabili obbligatorie
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

# ─── Build e avvio ────────────────────────────────────────────────
info "Build e avvio dello stack LRC System..."
docker compose up --build -d

# ─── Attesa health check ──────────────────────────────────────────
info "Attendo che il database sia pronto..."
timeout=60
elapsed=0
DB_USER="$(grep POSTGRES_USER .env | cut -d= -f2)"
DB_NAME="$(grep POSTGRES_DB .env | cut -d= -f2)"
DB_NAME="${DB_NAME:-lrc_system}"
while ! docker compose exec db pg_isready -U "$DB_USER" -d "$DB_NAME" -q 2>/dev/null; do
  sleep 2
  elapsed=$((elapsed+2))
  if [ $elapsed -ge $timeout ]; then
    error "Database non pronto dopo ${timeout}s. Controlla i log: ./deploy.sh logs"
  fi
done

# ─── Migrazioni ───────────────────────────────────────────────
info "Applico le migrazioni al database..."
MIGRATIONS=(
  "db/migrate.sql"
  "db/migrate-tickets.sql"
  "db/migrate-auth.sql"
  "db/migrate-heatmap.sql"
  "db/migrate-heatmap-hourly.sql"
  "db/migrate-dashboards.sql"
  "db/migrate-webthron-cache.sql"
  "db/migrate-system-config.sql"
)
for f in "${MIGRATIONS[@]}"; do
  if [ -f "$f" ]; then
    docker compose cp "$f" "db:/tmp/$(basename "$f")"
    docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" -q -f "/tmp/$(basename "$f")"
    info "  ✓ $(basename "$f")"
  fi
done

info "Stack avviato con successo!"
echo ""
echo "  Frontend  →  http://$(grep NEXT_PUBLIC_API_URL .env | cut -d= -f2- | sed 's/:3001//'| sed 's|http://||'):3000"
echo "  Backend   →  $(grep NEXT_PUBLIC_API_URL .env | cut -d= -f2-)/health"
echo ""
echo "  Log live  →  ./deploy.sh logs"
echo "  Stop      →  ./deploy.sh stop"

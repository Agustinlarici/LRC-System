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

# Tutto lo script tra graffe: bash lo legge per intero prima di eseguirlo,
# così il "git pull" dell'update non può cambiare lo script mentre gira.
{

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

required_vars=(POSTGRES_PASSWORD SERVER_IP NEXT_PUBLIC_API_URL CORS_ORIGINS BC_USER BC_PASSWORD)
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
TICKETS_HOST="${TICKETS_UPLOADS_HOST:-./data/tickets-uploads}"
mkdir -p "$SCAN_HOST" "$DOCS_HOST" "$TICKETS_HOST"

# ─── Certificati HTTPS (CA locale, generati una sola volta) ───────
if [ ! -f certs/server-cert.pem ]; then
  step "Genero i certificati HTTPS (prima esecuzione)..."
  bash certs/generate-certs.sh
fi

# ═══════════════════════════════════════════════════════════════════
# Funzione: sistema i permessi della cartella allegati ticket
# Il bind mount sovrascrive i permessi impostati nell'immagine (il chown
# nel Dockerfile non basta) con quelli della cartella host — che spesso
# appartiene a root o a un utente diverso da quello che esegue questo
# script, quindi un chmod lato host può fallire ("Operation not
# permitted"). Si sistema da dentro il container, come root del
# container: funziona a prescindere dai permessi dell'utente host.
# ═══════════════════════════════════════════════════════════════════
fix_upload_perms() {
  docker compose exec -T -u root backend sh -c "mkdir -p /app/uploads/tickets && chown -R node:node /app/uploads" 2>/dev/null \
    && info "Permessi cartella allegati ticket OK." \
    || warn "Non sono riuscito a sistemare i permessi di /app/uploads (il backend potrebbe non essere ancora avviato)."
}

# ═══════════════════════════════════════════════════════════════════
# Funzione: applica le migrazioni (stack deve essere running)
# ═══════════════════════════════════════════════════════════════════
run_migrations() {
  step "Applico le migrazioni al database (db/migrations, vedi db/README.md)..."
  # Servizio one-shot "migrate": ogni file una sola volta, in transazione,
  # si ferma al primo errore (prima gli errori venivano ignorati).
  docker compose run --rm migrate \
    || error "Migrazioni fallite: nessuna modifica parziale applicata. Lo stack attuale resta in funzione."
  info "Migrazioni completate."
}

# ═══════════════════════════════════════════════════════════════════
# migrate — solo migrazioni, stack già running
# ═══════════════════════════════════════════════════════════════════
if [ "$CMD" = "migrate" ]; then
  run_migrations
  fix_upload_perms
  exit 0
fi

# ═══════════════════════════════════════════════════════════════════
# update — zero-downtime: pull → migrate → build → swap
# ═══════════════════════════════════════════════════════════════════
if [ "$CMD" = "update" ]; then
  step "0/4  Backup di sicurezza pre-aggiornamento..."
  BACKUP_KIND=pre-deploy bash scripts/backup/backup.sh \
    || error "Backup pre-aggiornamento fallito: aggiornamento annullato."

  step "1/4  Git pull..."
  git pull

  step "2/4  Migrazioni DB (stack in running — nessun downtime)..."
  docker compose run --rm migrate --status || true
  run_migrations

  step "3/4  Build nuove immagini in background (nessun downtime)..."
  docker compose build --no-cache

  step "4/4  Swap container (~5 secondi di interruzione)..."
  docker compose up -d
  fix_upload_perms

  info "Aggiornamento completato."
  echo ""
  SERVER_IP_ECHO="$(grep -E '^SERVER_IP=' .env | cut -d= -f2-)"
  echo "  Frontend (ufficio)  →  http://${SERVER_IP_ECHO}:3000"
  echo "  Frontend (tablet)   →  https://${SERVER_IP_ECHO}:3443"
  echo "  Log live  →  ./deploy.sh logs"
  exit 0
fi

# ═══════════════════════════════════════════════════════════════════
# up — primo avvio o deploy completo
# ═══════════════════════════════════════════════════════════════════
step "Avvio stack LRC System..."
# Il servizio "migrate" gira automaticamente prima del backend (depends_on)
docker compose up --build -d \
  || error "Avvio fallito. Se il problema sono le migrazioni: docker compose logs migrate"

fix_upload_perms

info "Stack avviato con successo!"
echo ""
SERVER_IP_ECHO="$(grep -E '^SERVER_IP=' .env | cut -d= -f2-)"
echo "  Frontend (ufficio)  →  http://${SERVER_IP_ECHO}:3000"
echo "  Backend  (ufficio)  →  http://${SERVER_IP_ECHO}:3001/health"
echo "  Frontend (tablet)   →  https://${SERVER_IP_ECHO}:3443"
echo ""
echo "  Per il tablet: installa certs/ca-cert.pem come CA attendibile"
echo "  (Impostazioni > Sicurezza > Crittografia e credenziali > Installa certificato > CA)."
echo ""
echo "  Log live  →  ./deploy.sh logs"
echo "  Stop      →  ./deploy.sh stop"
echo "  Update    →  ./deploy.sh update"
exit 0
}

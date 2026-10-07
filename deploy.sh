#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# LRC System — Script di deploy produzione
#
# Uso:
#   ./deploy.sh            → primo avvio o deploy completo (build + swap)
#   ./deploy.sh update     → aggiornamento zero-downtime (backup + pull + migrate + build + swap + verifica)
#   ./deploy.sh migrate    → solo migrazioni DB (stack in running)
#   ./deploy.sh rollback   → torna alla versione prima dell'ultimo update
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
  up|update|migrate|rollback) ;;
  *) error "Comando sconosciuto: $CMD. Usa: up | update | migrate | rollback | stop | restart | logs" ;;
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
# Funzione: file SQL lasciati in db/ invece che in db/migrations/
# (abitudine del vecchio sistema: non verrebbero mai applicati)
# ═══════════════════════════════════════════════════════════════════
stray_sql() {
  local stray
  stray="$(find db -maxdepth 1 -name '*.sql' 2>/dev/null)"
  [ -z "$stray" ] && return 1
  warn "File SQL fuori da db/migrations/ (non verrebbero applicati):"
  echo "$stray" | sed 's/^/        /'
  warn "Spostarli in db/migrations/ col numero successivo (vedi db/README.md)."
  return 0
}

# ═══════════════════════════════════════════════════════════════════
# Funzione: applica le migrazioni (stack deve essere running)
# ═══════════════════════════════════════════════════════════════════
run_migrations() {
  stray_sql && error "Migrazioni non applicate: sistemare i file indicati sopra."
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
# ═══════════════════════════════════════════════════════════════════
# Funzioni di sicurezza per l'update
# ═══════════════════════════════════════════════════════════════════
# Il backend risponde /health con status "ok" entro 90 secondi?
backend_healthy() {
  local elapsed=0
  while [ $elapsed -lt 90 ]; do
    docker compose exec -T backend wget -qO- http://localhost:3001/health 2>/dev/null | grep -q '"status":"ok"' && return 0
    sleep 3; elapsed=$((elapsed+3))
  done
  return 1
}

# Riporta il codice alla versione precedente (mantiene eventuali modifiche
# locali non committate: --keep si rifiuta invece di sovrascriverle).
revert_code() {
  warn "Riporto il codice alla versione precedente ($(git rev-parse --short "$1"))..."
  git reset --keep "$1" || warn "git reset non riuscito: eseguire a mano  git reset --keep $1"
}

# ═══════════════════════════════════════════════════════════════════
# update — zero-downtime: backup → pull → migrate → build → swap → verifica
# Se qualcosa fallisce, la versione in funzione resta (o torna) quella precedente.
# ═══════════════════════════════════════════════════════════════════
if [ "$CMD" = "update" ]; then
  PREV_COMMIT="$(git rev-parse HEAD)"

  step "0/5  Backup di sicurezza pre-aggiornamento..."
  BACKUP_KIND=pre-deploy bash scripts/backup/backup.sh \
    || error "Backup pre-aggiornamento fallito: aggiornamento annullato (niente è stato modificato)."

  step "1/5  Git pull..."
  git pull || error "git pull fallito: aggiornamento annullato (niente è stato modificato)."
  if [ "$(git rev-parse HEAD)" = "$PREV_COMMIT" ]; then
    info "Nessuna novità da aggiornare."
  fi

  if stray_sql; then
    revert_code "$PREV_COMMIT"
    error "Aggiornamento annullato prima di toccare il database. Il programma continua a funzionare."
  fi

  step "2/5  Migrazioni DB (stack in running — nessun downtime)..."
  docker compose run --rm migrate --status || true
  if ! docker compose run --rm migrate; then
    revert_code "$PREV_COMMIT"
    error "Migrazioni fallite (annullate, nessuna modifica parziale). Il programma continua a funzionare con la versione precedente."
  fi

  step "3/5  Build nuove immagini in background (nessun downtime)..."
  if ! docker compose build --no-cache; then
    revert_code "$PREV_COMMIT"
    error "Build fallita. Il programma continua a funzionare con la versione precedente."
  fi

  step "4/5  Swap container (~5 secondi di interruzione)..."
  docker compose up -d
  fix_upload_perms

  step "5/5  Verifica che il backend risponda..."
  if ! backend_healthy; then
    warn "Il backend non risponde dopo l'aggiornamento: torno automaticamente alla versione precedente."
    revert_code "$PREV_COMMIT"
    docker compose build && docker compose up -d
    if backend_healthy; then
      error "Aggiornamento annullato: ripristinata la versione precedente, che funziona. Log: docker compose logs backend"
    else
      error "ATTENZIONE: anche la versione precedente non risponde. Vedi docs/DISASTER-RECOVERY.md (procedura B)."
    fi
  fi
  echo "$PREV_COMMIT" > .deploy-previous

  info "Aggiornamento completato e verificato."
  echo ""
  SERVER_IP_ECHO="$(grep -E '^SERVER_IP=' .env | cut -d= -f2-)"
  echo "  Frontend (ufficio)  →  http://${SERVER_IP_ECHO}:3000"
  echo "  Frontend (tablet)   →  https://${SERVER_IP_ECHO}:3443"
  echo "  Log live  →  ./deploy.sh logs"
  echo "  Tornare indietro  →  ./deploy.sh rollback"
  exit 0
fi

# ═══════════════════════════════════════════════════════════════════
# rollback — torna alla versione prima dell'ultimo update riuscito
# (il database non viene toccato: le migrazioni aggiungono e non tolgono;
#  per tornare anche coi dati: docs/DISASTER-RECOVERY.md, procedura B)
# ═══════════════════════════════════════════════════════════════════
if [ "$CMD" = "rollback" ]; then
  [ -f .deploy-previous ] || error "Nessun update precedente registrato (.deploy-previous mancante)."
  PREV_COMMIT="$(cat .deploy-previous)"
  step "Torno alla versione $(git rev-parse --short "$PREV_COMMIT")..."
  git reset --keep "$PREV_COMMIT" || error "git reset non riuscito (modifiche locali in conflitto?)."
  docker compose build
  docker compose up -d
  backend_healthy && info "Rollback completato, il backend risponde." \
    || error "Il backend non risponde dopo il rollback. Vedi docs/DISASTER-RECOVERY.md."
  rm -f .deploy-previous
  exit 0
fi

# ═══════════════════════════════════════════════════════════════════
# up — primo avvio o deploy completo
# ═══════════════════════════════════════════════════════════════════
step "Avvio stack LRC System..."
stray_sql && error "Avvio annullato: sistemare i file SQL indicati sopra."
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

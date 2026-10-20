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
# Funzioni di sicurezza per l'update / rollback
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

# Immagini costruite da questo progetto (backend, frontend)
built_images() { docker compose config --images 2>/dev/null | grep -E -- '-(backend|frontend)(:|$)' || true; }

# Prima della build: conserva le immagini in funzione come ":previous",
# così il ritorno indietro è immediato e identico (niente ricompilazione).
save_images() {
  local img
  for img in $(built_images); do
    docker image inspect "$img" >/dev/null 2>&1 && docker tag "$img" "${img%%:*}:previous"
  done
  return 0
}

# Rimette in uso le immagini ":previous" (false se mancano)
restore_images() {
  local img ok=0
  for img in $(built_images); do
    if docker image inspect "${img%%:*}:previous" >/dev/null 2>&1; then
      docker tag "${img%%:*}:previous" "$img"
    else
      ok=1
    fi
  done
  return $ok
}

# Torna alla versione precedente (codice + immagini) e verifica che risponda.
# Il DB resta com'è: le migrazioni aggiungono, il codice vecchio le ignora
# (migrate.sh accetta un DB "più avanti" del codice).
go_back() {
  revert_code "$1"
  if restore_images; then
    docker compose up -d --no-build || return 1
  else
    warn "Immagini precedenti non disponibili: ricompilo la versione precedente..."
    docker compose build && docker compose up -d || return 1
  fi
  backend_healthy
}

# Backup pre-deploy: la cartella dei backup è di root, il resto del deploy no
# (git deve girare con l'utente che possiede il repository).
pre_deploy_backup() {
  if [ "$(id -u)" = 0 ]; then
    BACKUP_KIND=pre-deploy bash scripts/backup/backup.sh
  else
    info "Il backup richiede i permessi di root (sudo):"
    sudo env BACKUP_KIND=pre-deploy bash scripts/backup/backup.sh
  fi
}

# ═══════════════════════════════════════════════════════════════════
# update — zero-downtime: backup → pull → migrate → controllo schema →
#          build → swap → verifica
# Se qualcosa fallisce, la versione in funzione resta (o torna) quella precedente.
# ═══════════════════════════════════════════════════════════════════
if [ "$CMD" = "update" ]; then
  [ "$(id -u)" = 0 ] && warn "Stai eseguendo deploy.sh come root: meglio come utente normale (il backup chiede sudo da solo)."
  # LRC_PULLED=1: il "git pull" è già stato fatto (dal vecchio deploy.sh, che dopo
  # il pull rilancia questo script, oppure a mano). La versione precedente è ORIG_HEAD.
  if [ "${LRC_PULLED:-0}" = 1 ]; then
    PREV_COMMIT="$(git rev-parse ORIG_HEAD 2>/dev/null)" || error "LRC_PULLED=1 ma ORIG_HEAD non esiste: fare  git pull  e riprovare."
    if [ "$PREV_COMMIT" = "$(git rev-parse HEAD)" ] \
       || { [ -f .deploy-previous ] && [ "$(cat .deploy-previous)" = "$PREV_COMMIT" ]; }; then
      info "Nessuna novità da aggiornare (questo aggiornamento è già stato fatto)."
      exit 0
    fi
    info "Codice già aggiornato col git pull; versione precedente: $(git rev-parse --short "$PREV_COMMIT")"
  else
    PREV_COMMIT="$(git rev-parse HEAD)"
    step "0/6  Controllo novità..."
    git fetch || error "git fetch fallito: aggiornamento annullato (niente è stato modificato)."
    UPSTREAM="$(git rev-parse '@{u}' 2>/dev/null)" || error "Il branch attuale non segue un branch remoto (git checkout <branch>)."
    if [ "$UPSTREAM" = "$PREV_COMMIT" ]; then
      info "Nessuna novità da aggiornare."
      exit 0
    fi
  fi

  step "1/6  Backup di sicurezza pre-aggiornamento..."
  if ! pre_deploy_backup; then
    [ "${LRC_PULLED:-0}" = 1 ] && revert_code "$PREV_COMMIT"
    error "Backup pre-aggiornamento fallito: aggiornamento annullato (niente è stato modificato)."
  fi

  if [ "${LRC_PULLED:-0}" != 1 ]; then
    step "2/6  Git pull..."
    git pull --ff-only || error "git pull fallito: aggiornamento annullato (niente è stato modificato)."
  fi

  if stray_sql; then
    revert_code "$PREV_COMMIT"
    error "Aggiornamento annullato prima di toccare il database. Il programma continua a funzionare."
  fi

  step "3/6  Migrazioni DB (stack in running — nessun downtime)..."
  docker compose run --rm migrate --status || true
  if ! docker compose run --rm migrate; then
    revert_code "$PREV_COMMIT"
    error "Migrazioni fallite (annullate, nessuna modifica parziale). Il programma continua a funzionare con la versione precedente."
  fi

  # Lo schema reale deve coincidere con quello delle migrazioni: protegge da
  # modifiche fatte a mano e dal passaggio dal vecchio sistema (DB "legacy").
  step "4/6  Controllo schema (produzione = migrazioni)..."
  if ! bash db/check-drift.sh; then
    revert_code "$PREV_COMMIT"
    error "Lo schema del DB non coincide con le migrazioni (vedi drift-report-*.txt). Aggiornamento annullato prima dello swap: il programma continua a funzionare. Dopo aver verificato il report: LRC_ACCEPT_DRIFT=1 ./deploy.sh update"
  fi

  step "5/6  Build nuove immagini in background (nessun downtime)..."
  save_images
  if ! docker compose build --no-cache; then
    revert_code "$PREV_COMMIT"
    restore_images || true
    error "Build fallita. Il programma continua a funzionare con la versione precedente."
  fi

  step "6/6  Swap container (~5 secondi di interruzione) e verifica..."
  if docker compose up -d && backend_healthy; then
    fix_upload_perms
  else
    warn "Il backend non risponde dopo l'aggiornamento: torno automaticamente alla versione precedente."
    if go_back "$PREV_COMMIT"; then
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
# Il database resta com'è (le migrazioni aggiungono, il codice vecchio le
# ignora). Per tornare anche ai dati di prima dell'update:
#   sudo scripts/backup/restore.sh latest-pre-deploy
# ═══════════════════════════════════════════════════════════════════
if [ "$CMD" = "rollback" ]; then
  [ -f .deploy-previous ] || error "Nessun update precedente registrato (.deploy-previous mancante)."
  PREV_COMMIT="$(cat .deploy-previous)"
  step "Torno alla versione $(git rev-parse --short "$PREV_COMMIT")..."
  if go_back "$PREV_COMMIT"; then
    rm -f .deploy-previous
    info "Rollback completato, il backend risponde. Il DB non è stato modificato."
    info "Se servono anche i dati di prima dell'update: sudo scripts/backup/restore.sh latest-pre-deploy"
  else
    error "Il backend non risponde dopo il rollback. Vedi docs/DISASTER-RECOVERY.md."
  fi
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

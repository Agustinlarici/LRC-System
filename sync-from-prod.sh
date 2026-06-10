#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# sync-from-prod.sh — Copia il DB di produzione nel dev locale
#
# SICUREZZA:
#   - Sul server di produzione esegue SOLO pg_dump (lettura pura)
#   - Non scrive MAI nulla sul server di produzione
#   - Prima di sovrascrivere il dev locale, fa un backup automatico
#
# Uso: ./sync-from-prod.sh
# ═══════════════════════════════════════════════════════════════════
set -e

PROD_HOST="${PROD_HOST:-192.168.5.22}"
PROD_DIR="${PROD_DIR:-~/lrc-system}"
PROD_DB="lrc_system"
PROD_DB_USER="lrc"
PROD_CONTAINER="lrc-system-db-1"

LOCAL_DB="lrc_system_dev"
LOCAL_DB_USER="lrc"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
PROD_DUMP="/tmp/lrc_prod_${TIMESTAMP}.sql"
LOCAL_BACKUP="/tmp/lrc_dev_backup_${TIMESTAMP}.sql"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${GREEN}[sync]${NC} $1"; }
step()  { echo -e "${CYAN}[sync]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }

echo ""
echo -e "${YELLOW}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${YELLOW}║  SYNC DB PRODUZIONE → DEV LOCALE                         ║${NC}"
echo -e "${YELLOW}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

read -p "  Utente SSH (es. alarici@strlan.local): " PROD_USER
read -p "  Server IP  [${PROD_HOST}]: " INPUT_HOST
[ -n "$INPUT_HOST" ] && PROD_HOST="$INPUT_HOST"

echo ""
echo -e "  Produzione : ${RED}${PROD_USER}@${PROD_HOST}${NC} (solo lettura — pg_dump)"
echo -e "  Locale     : ${GREEN}${LOCAL_DB}${NC} (verrà sovrascritto)"
echo ""
warn "Il DB locale verrà sostituito con quello di produzione."
warn "Un backup automatico del locale verrà salvato in /tmp prima di procedere."
echo ""
read -p "Continuare? (scrivi 'si' per confermare) " CONFIRM
if [ "$CONFIRM" != "si" ]; then
  echo "Annullato."
  exit 0
fi

echo ""

# ─── 1. Backup del DB locale ──────────────────────────────────────
step "1/5  Backup del DB dev locale in ${LOCAL_BACKUP}..."
if docker compose -f docker-compose.dev.yml exec -T db \
    pg_dump -U "${LOCAL_DB_USER}" -d "${LOCAL_DB}" --no-owner --no-acl \
    > "${LOCAL_BACKUP}" 2>/dev/null; then
  info "Backup locale salvato: ${LOCAL_BACKUP} ($(du -sh "${LOCAL_BACKUP}" | cut -f1))"
else
  warn "Backup locale non riuscito (DB dev probabilmente vuoto) — si continua comunque."
fi

# ─── 2. Dump dal server di produzione ────────────────────────────
step "2/5  Dump DB produzione da ${PROD_HOST} (sola lettura)..."
ssh -l "${PROD_USER}" "${PROD_HOST}" \
  "cd ${PROD_DIR} && docker exec ${PROD_CONTAINER} pg_dump -U ${PROD_DB_USER} -d ${PROD_DB} --no-owner --no-acl" \
  > "${PROD_DUMP}"
info "Dump produzione ricevuto: $(du -sh "${PROD_DUMP}" | cut -f1)"

# ─── 3. Avvio container DB locale ─────────────────────────────────
step "3/5  Avvio container DB locale..."
docker compose -f docker-compose.dev.yml up -d db
sleep 3

# ─── 4. Drop + restore nel DB dev locale ──────────────────────────
step "4/5  Ripristino in ${LOCAL_DB}..."
docker compose -f docker-compose.dev.yml exec -T db \
  psql -U "${LOCAL_DB_USER}" -d postgres -q \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${LOCAL_DB}' AND pid <> pg_backend_pid();" \
  > /dev/null 2>&1 || true

docker compose -f docker-compose.dev.yml exec -T db \
  psql -U "${LOCAL_DB_USER}" -d postgres -q \
  -c "DROP DATABASE IF EXISTS ${LOCAL_DB};" > /dev/null

docker compose -f docker-compose.dev.yml exec -T db \
  psql -U "${LOCAL_DB_USER}" -d postgres -q \
  -c "CREATE DATABASE ${LOCAL_DB};" > /dev/null

docker compose -f docker-compose.dev.yml exec -T db \
  psql -U "${LOCAL_DB_USER}" -d "${LOCAL_DB}" --quiet < "${PROD_DUMP}"

# ─── 5. Pulizia ───────────────────────────────────────────────────
step "5/5  Pulizia dump temporaneo..."
rm "${PROD_DUMP}"

echo ""
info "Sync completato con successo."
echo ""
echo -e "  Backup locale disponibile in: ${YELLOW}${LOCAL_BACKUP}${NC}"
echo -e "  Per ripristinare il backup locale in caso di problemi:"
echo -e "    docker compose -f docker-compose.dev.yml exec -T db psql -U ${LOCAL_DB_USER} -d postgres -c \"DROP DATABASE ${LOCAL_DB}; CREATE DATABASE ${LOCAL_DB};\""
echo -e "    docker compose -f docker-compose.dev.yml exec -T db psql -U ${LOCAL_DB_USER} -d ${LOCAL_DB} < ${LOCAL_BACKUP}"
echo ""
echo "  Riavvia il backend dev per ricaricare la cache:"
echo "  docker compose -f docker-compose.dev.yml restart backend"
echo ""

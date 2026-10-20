#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# LRC System — Confronta lo schema del DB di produzione con quello
# che si ottiene installando da zero con db/migrations.
#
# Uso (sul server, nella cartella del progetto):  db/check-drift.sh
#
# Non modifica nulla: crea un PostgreSQL temporaneo e isolato, ci applica
# le migrazioni e confronta gli schemi (solo struttura, nessun dato).
# Esito 0 = identici (o differenze già accettate con LRC_ACCEPT_DRIFT=1).
# Altrimenti esito 1 e differenze in drift-report-<data>.txt
# Da eseguire PRIMA del primo deploy col nuovo sistema di migrazioni e
# ogni volta che si sospetta che il DB sia stato modificato a mano.
# ═══════════════════════════════════════════════════════════════════
set -Eeuo pipefail
cd "$(dirname "$0")/.."

env_get() { { grep -E "^$1=" .env 2>/dev/null || true; } | tail -n1 | cut -d= -f2- | tr -d '\r"'"'"; }
DB_USER="$(env_get POSTGRES_USER)"; DB_USER="${DB_USER:-lrc}"
DB_NAME="$(env_get POSTGRES_DB)";   DB_NAME="${DB_NAME:-lrc_system}"
IMAGE="${PG_IMAGE:-postgres:16-alpine}"
C="lrc-drift-$$"
REPORT="drift-report-$(date +%Y%m%d-%H%M).txt"
TMP="$(mktemp -d)"
trap 'docker rm -f "$C" >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT

# Toglie righe variabili e ordina le colonne dentro ogni CREATE TABLE: l'ordine
# delle colonne dipende dalla storia degli ALTER e non è una differenza reale.
normalize() {
  grep -vE '^(--|SET |SELECT pg_catalog|\\(un)?restrict )' | sed '/^$/d' | awk '
    /^CREATE TABLE .*\($/ { print; intable=1; n=0; next }
    intable && /^\);?$|^\)/ {
      cmd="sort"; for (i=1;i<=n;i++) print cols[i] | cmd; close(cmd); print; intable=0; next }
    intable { sub(/,$/, ""); cols[++n]=$0; next }
    { print }'
}

echo "Schema di produzione ($DB_NAME)..."
docker compose exec -T db pg_dump -U "$DB_USER" -d "$DB_NAME" --schema-only --no-owner --no-privileges \
  -T schema_migrations | normalize > "$TMP/prod.sql"

echo "Schema da migrazioni (container temporaneo)..."
docker run -d --name "$C" --network none -e POSTGRES_PASSWORD=x -e POSTGRES_USER="$DB_USER" -e POSTGRES_DB="$DB_NAME" \
  -v "$PWD/db/migrate.sh:/migrate.sh:ro" -v "$PWD/db/migrations:/migrations:ro" "$IMAGE" >/dev/null
for _ in $(seq 1 60); do docker exec "$C" psql -U "$DB_USER" -d "$DB_NAME" -qtAc 'SELECT 1' >/dev/null 2>&1 && break; sleep 1; done
sleep 2
docker exec -e PGUSER="$DB_USER" -e PGDATABASE="$DB_NAME" "$C" bash /migrate.sh > "$TMP/migrate.log" 2>&1 \
  || { cat "$TMP/migrate.log"; echo "ERRORE: le migrazioni non si applicano su un DB vuoto"; exit 2; }
docker exec "$C" pg_dump -U "$DB_USER" -d "$DB_NAME" --schema-only --no-owner --no-privileges \
  -T schema_migrations | normalize > "$TMP/fresh.sql"

if diff -u "$TMP/fresh.sql" "$TMP/prod.sql" > "$TMP/diff.txt"; then
  echo "✓ Nessuna differenza: produzione = installazione da zero ($(grep -c '^CREATE TABLE' "$TMP/prod.sql") tabelle)"
  exit 0
fi
{
  echo "# Differenze di schema — $(date)"
  echo "# '-' = solo nell'installazione da zero (migrazioni)   '+' = solo in produzione"
  echo
  cat "$TMP/diff.txt"
} > "$REPORT"
n=$(grep -c '^[-+][^-+]' "$TMP/diff.txt" || true)

# Differenze già esaminate e accettate su questo server: non bloccano più,
# ma qualunque differenza NUOVA sì. (.drift-accepted non è nel repository)
hash=$(grep '^[-+][^-+]' "$TMP/diff.txt" | sha256sum | cut -d' ' -f1)
if [ -f .drift-accepted ] && grep -qx "$hash" .drift-accepted; then
  echo "! Schema diverso dalle migrazioni ($n righe) ma differenze GIÀ ACCETTATE in precedenza. Dettagli in $REPORT"
  exit 0
fi
if [ "${LRC_ACCEPT_DRIFT:-0}" = 1 ]; then
  echo "$hash" > .drift-accepted
  echo "! Schema diverso dalle migrazioni ($n righe): differenze ACCETTATE (LRC_ACCEPT_DRIFT=1). Dettagli in $REPORT"
  exit 0
fi
echo "✗ Gli schemi differiscono: $n righe. Dettagli in $REPORT"
exit 1

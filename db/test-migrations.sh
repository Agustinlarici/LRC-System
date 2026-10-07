#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# LRC System — Test delle migrazioni (gira in CI e in locale, serve Docker)
#
#   1. DB vuoto: tutte le migrazioni si applicano senza errori
#   2. Seconda esecuzione: nessuna migrazione da applicare (idempotenza)
#   3. Migrazione modificata dopo l'applicazione: il runner si rifiuta
#   4. Migrazione che fallisce: rollback completo, niente registrato
#   5. DB "legacy" (vecchio deploy.sh): registrazione iniziale e poi 0 pendenti
#   6. Schema finale identico tra installazione nuova e DB legacy
# ═══════════════════════════════════════════════════════════════════
set -Eeuo pipefail
cd "$(dirname "$0")/.."

IMAGE="${PG_IMAGE:-postgres:16-alpine}"
NET="lrc-migtest-$$"
DB_C="lrc-migtest-db-$$"
WORK="$(mktemp -d)"
pass() { echo "  ✓ $*"; }
fail() { echo "  ✗ $*" >&2; exit 1; }

cleanup() { docker rm -f "$DB_C" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

docker network create "$NET" >/dev/null
docker run -d --name "$DB_C" --network "$NET" -e POSTGRES_PASSWORD=test -e POSTGRES_USER=lrc "$IMAGE" >/dev/null
for _ in $(seq 1 60); do docker exec "$DB_C" psql -U lrc -d postgres -qtAc 'SELECT 1' >/dev/null 2>&1 && break; sleep 1; done
sleep 2

sql()  { docker exec -i "$DB_C" psql -U lrc -d "$1" -X -qtA -v ON_ERROR_STOP=1 -c "$2"; }
newdb() { sql postgres "DROP DATABASE IF EXISTS $1" >/dev/null; sql postgres "CREATE DATABASE $1" >/dev/null; }
# Esegue il runner come farebbe il servizio "migrate" di docker compose
run() {
  local db="$1" dir="$2"; shift 2
  docker run --rm --network "$NET" -e PGHOST="$DB_C" -e PGUSER=lrc -e PGPASSWORD=test -e PGDATABASE="$db" \
    -v "$PWD/db/migrate.sh:/migrate.sh:ro" -v "$dir:/migrations:ro" "$IMAGE" bash /migrate.sh "$@"
}
schema() { docker exec "$DB_C" pg_dump -U lrc -d "$1" --schema-only --no-owner -T schema_migrations | grep -vE '^(--|SET |SELECT pg_catalog|\\(un)?restrict )' | sed '/^$/d'; }
TOTAL=$(find db/migrations -name '*.sql' | wc -l)

echo "0. File SQL fuori da db/migrations (verrebbero ignorati)"
stray=$(find db -maxdepth 1 -name '*.sql')
[ -z "$stray" ] || fail "spostare in db/migrations/ con numero: $stray"
pass "nessuno"

echo "1. Installazione da zero"
newdb fresh
run fresh "$PWD/db/migrations" > "$WORK/out1" 2>&1 || { cat "$WORK/out1"; fail "migrazioni su DB vuoto"; }
n=$(sql fresh "SELECT count(*) FROM schema_migrations")
[ "$n" = "$TOTAL" ] || fail "registrate $n su $TOTAL"
pass "$TOTAL migrazioni applicate"

echo "2. Idempotenza"
run fresh "$PWD/db/migrations" > "$WORK/out2" 2>&1 || { cat "$WORK/out2"; fail "seconda esecuzione"; }
grep -q "0 da applicare" "$WORK/out2" || fail "la seconda esecuzione non è vuota"
pass "seconda esecuzione: 0 da applicare"

echo "3. Migrazione modificata"
cp -r db/migrations "$WORK/tampered"
echo "-- modifica" >> "$WORK/tampered/0001_schema.sql"
if run fresh "$WORK/tampered" > "$WORK/out3" 2>&1; then fail "il runner ha accettato un file modificato"; fi
grep -q "MODIFICATA" "$WORK/out3" || { cat "$WORK/out3"; fail "messaggio atteso assente"; }
pass "file modificato rifiutato"

echo "4. Migrazione che fallisce → rollback"
cp -r db/migrations "$WORK/broken"
cat > "$WORK/broken/9998_test-ok.sql" <<'EOF'
CREATE TABLE test_rollback_ok (id INT);
EOF
cat > "$WORK/broken/9999_test-broken.sql" <<'EOF'
CREATE TABLE test_rollback_broken (id INT);
SELECT * FROM tabella_che_non_esiste;
EOF
if run fresh "$WORK/broken" > "$WORK/out4" 2>&1; then fail "una migrazione rotta è passata"; fi
[ "$(sql fresh "SELECT to_regclass('test_rollback_ok') IS NOT NULL")" = t ] || fail "9998 non applicata"
[ "$(sql fresh "SELECT to_regclass('test_rollback_broken') IS NULL")" = t ] || fail "rollback non avvenuto"
[ "$(sql fresh "SELECT count(*) FROM schema_migrations WHERE version='9999'")" = 0 ] || fail "9999 registrata"
pass "rollback completo, la migrazione fallita non è registrata"

echo "5. DB legacy (vecchio deploy.sh: file rieseguiti a ogni deploy, errori ignorati)"
newdb legacy
for _ in 1 2; do
  for f in db/migrations/*.sql; do docker exec -i "$DB_C" psql -U lrc -d legacy -X -q < "$f" >/dev/null 2>&1 || true; done
done
run legacy "$PWD/db/migrations" > "$WORK/out5" 2>&1 || { cat "$WORK/out5"; fail "registrazione legacy"; }
grep -q "modalità legacy" "$WORK/out5" || fail "modalità legacy non rilevata"
[ "$(sql legacy "SELECT count(*) FROM schema_migrations")" = "$TOTAL" ] || fail "legacy: conteggio errato"
run legacy "$PWD/db/migrations" > "$WORK/out5b" 2>&1 || { cat "$WORK/out5b"; fail "legacy: seconda esecuzione"; }
grep -q "0 da applicare" "$WORK/out5b" || fail "legacy: seconda esecuzione non vuota"
pass "registrazione legacy e poi 0 da applicare"

echo "6. Schema: installazione nuova = DB legacy"
newdb fresh2
run fresh2 "$PWD/db/migrations" >/dev/null 2>&1
if ! diff <(schema fresh2) <(schema legacy) > "$WORK/diff6"; then
  head -60 "$WORK/diff6"; fail "gli schemi differiscono"
fi
pass "schemi identici ($(schema fresh2 | grep -c '^CREATE TABLE') tabelle)"

echo "Tutti i test superati."

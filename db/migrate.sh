#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# LRC System — Esecutore delle migrazioni del database
#
# Gira nel servizio docker "migrate" (vedi docker-compose.yml):
#   docker compose run --rm migrate            → applica le migrazioni mancanti
#   docker compose run --rm migrate --status   → mostra lo stato, non applica nulla
#
# Regole (vedi db/README.md):
#   - file in db/migrations/ con nome NNNN_descrizione.sql, applicati in ordine
#   - ogni file viene applicato UNA sola volta e registrato in schema_migrations
#   - un file già applicato NON si modifica: si crea una nuova migrazione
#     (il checksum viene verificato e lo script si ferma se cambia)
#   - ogni file gira in una transazione: se fallisce non lascia modifiche a metà.
#     Eccezione: i file con "-- migrate:no-transaction" nella prima riga
#     (necessario per ALTER TYPE ... ADD VALUE) devono essere idempotenti.
#
# Connessione: variabili standard PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE.
# ═══════════════════════════════════════════════════════════════════
set -Eeuo pipefail

MIGRATIONS_DIR="${MIGRATIONS_DIR:-/migrations}"
LOCK_ID=7310042   # pg_advisory_lock: una sola esecuzione alla volta
STATUS_ONLY=0
[ "${1:-}" = "--status" ] && STATUS_ONLY=1

log() { echo "[migrate] $*"; }
now_ms() { local t="${EPOCHREALTIME/[.,]/}"; echo $(( t / 1000 )); }   # niente "date +%N" su busybox
die() { echo "[migrate] ERRORE: $*" >&2; exit 1; }

PSQL=(psql -X -q -v ON_ERROR_STOP=1)
q() { "${PSQL[@]}" -tA -c "$1"; }

# ─── Attesa database ─────────────────────────────────────────────
for _ in $(seq 1 60); do
  pg_isready -q && q "SELECT 1" >/dev/null 2>&1 && break
  sleep 1
done
q "SELECT 1" >/dev/null || die "database non raggiungibile ($PGHOST/$PGDATABASE)"

# ─── Elenco e validazione dei file ───────────────────────────────
[ -d "$MIGRATIONS_DIR" ] || die "cartella $MIGRATIONS_DIR non trovata"
FILES=()
for p in "$MIGRATIONS_DIR"/*.sql; do [ -f "$p" ] && FILES+=("${p##*/}"); done   # glob: già in ordine
[ "${#FILES[@]}" -gt 0 ] || die "nessuna migrazione in $MIGRATIONS_DIR"
declare -A SEEN=()
for f in "${FILES[@]}"; do
  [[ "$f" =~ ^[0-9]{4}_[a-z0-9-]+\.sql$ ]] || die "nome non valido: $f (atteso NNNN_descrizione.sql)"
  v="${f:0:4}"
  [ -z "${SEEN[$v]:-}" ] || die "numero duplicato $v: ${SEEN[$v]} e $f"
  SEEN[$v]="$f"
done

checksum() { sha256sum "$MIGRATIONS_DIR/$1" | cut -d' ' -f1; }
no_tx()    { head -n1 "$MIGRATIONS_DIR/$1" | grep -q 'migrate:no-transaction'; }

# ─── Stato attuale ───────────────────────────────────────────────
has_table=$(q "SELECT to_regclass('public.schema_migrations') IS NOT NULL")
has_data=$(q "SELECT to_regclass('public.users') IS NOT NULL")
LEGACY=0
if [ "$has_table" = f ] && [ "$has_data" = t ]; then
  LEGACY=1   # DB esistente creato col vecchio sistema (deploy.sh rieseguiva tutti i file)
fi

if [ "$STATUS_ONLY" = 1 ]; then
  if [ "$has_table" = f ]; then
    log "schema_migrations assente — $( [ $LEGACY = 1 ] && echo 'DB esistente: alla prima esecuzione verrà registrato (modalità legacy)' || echo 'DB vuoto')"
    log "${#FILES[@]} migrazioni da applicare"
    exit 0
  fi
fi

if [ "$has_table" = f ]; then
  q "CREATE TABLE IF NOT EXISTS schema_migrations (
       version     CHAR(4)     PRIMARY KEY,
       name        TEXT        NOT NULL,
       checksum    CHAR(64)    NOT NULL,
       mode        VARCHAR(10) NOT NULL,
       duration_ms INTEGER     NOT NULL,
       applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )" >/dev/null
fi

# ─── Modalità legacy: prima esecuzione su un DB già in produzione ─
# Riproduce esattamente il vecchio deploy.sh (tutti i file, errori tollerati
# perché i file erano pensati per essere rieseguiti) e registra tutto.
# Da questo momento in poi vale il sistema nuovo.
if [ "$LEGACY" = 1 ]; then
  log "DB esistente senza schema_migrations → registrazione iniziale (modalità legacy)"
  warnings=0
  for f in "${FILES[@]}"; do
    start=$(now_ms)
    if out=$(psql -X -q -f "$MIGRATIONS_DIR/$f" 2>&1); then :; fi
    if echo "$out" | grep -q 'ERROR'; then
      warnings=$((warnings+1))
      log "  ! $f (errori tollerati come nel vecchio deploy):"
      echo "$out" | grep 'ERROR' | sed 's/^/        /'
    else
      log "  ✓ $f"
    fi
    q "INSERT INTO schema_migrations (version, name, checksum, mode, duration_ms)
       VALUES ('${f:0:4}', '$f', '$(checksum "$f")', 'legacy', $(( $(now_ms) - start )))" >/dev/null
  done
  log "Registrazione completata: ${#FILES[@]} migrazioni, $warnings con errori tollerati."
  exit 0
fi

# ─── Verifica integrità delle migrazioni già applicate ───────────
declare -A APPLIED=()
while IFS='|' read -r v name sum; do
  [ -n "$v" ] || continue
  APPLIED[$v]="$name|$sum"
done < <(q "SELECT version, name, checksum FROM schema_migrations ORDER BY version")

errors=0
for v in "${!APPLIED[@]}"; do
  name="${APPLIED[$v]%%|*}"; sum="${APPLIED[$v]##*|}"
  if [ -z "${SEEN[$v]:-}" ]; then
    echo "[migrate] ERRORE: la migrazione applicata $name non esiste più nel codice" >&2; errors=$((errors+1))
  elif [ "$(checksum "${SEEN[$v]}")" != "$sum" ]; then
    echo "[migrate] ERRORE: ${SEEN[$v]} è stata MODIFICATA dopo essere stata applicata." >&2
    echo "[migrate]         Ripristinare il file originale e mettere la modifica in una nuova migrazione." >&2
    errors=$((errors+1))
  fi
done
[ "$errors" = 0 ] || die "$errors problemi di integrità — nessuna migrazione applicata"

PENDING=()
for f in "${FILES[@]}"; do
  [ -n "${APPLIED[${f:0:4}]:-}" ] || PENDING+=("$f")
done
# Una migrazione nuova con numero inferiore all'ultima applicata indica un merge
# fatto male (due rami con lo stesso numero): meglio fermarsi.
last=$(q "SELECT COALESCE(MAX(version), '0000') FROM schema_migrations")
for f in "${PENDING[@]}"; do
  [[ "${f:0:4}" > "$last" ]] || die "$f ha numero inferiore all'ultima applicata ($last): rinumerarla"
done

log "${#APPLIED[@]} già applicate, ${#PENDING[@]} da applicare"
if [ "$STATUS_ONLY" = 1 ]; then
  for f in "${PENDING[@]}"; do log "  - $f"; done
  exit 0
fi

# ─── Applicazione ────────────────────────────────────────────────
for f in "${PENDING[@]}"; do
  v="${f:0:4}"; sum="$(checksum "$f")"
  if no_tx "$f"; then mode=no-tx; else mode=tx; fi
  start=$(now_ms)
  # La registrazione avviene nella stessa sessione/transazione del file.
  # Il lock + ricontrollo evita doppie applicazioni da esecuzioni parallele.
  if [ "$mode" = tx ]; then
    script="BEGIN;
SELECT pg_advisory_xact_lock($LOCK_ID);
SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '$v') AS done \\gset
\\if :done
\\else
\\i $MIGRATIONS_DIR/$f
INSERT INTO schema_migrations (version, name, checksum, mode, duration_ms) VALUES ('$v', '$f', '$sum', 'tx', 0);
\\endif
COMMIT;"
  else
    script="SELECT pg_advisory_lock($LOCK_ID);
SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '$v') AS done \\gset
\\if :done
\\else
\\i $MIGRATIONS_DIR/$f
INSERT INTO schema_migrations (version, name, checksum, mode, duration_ms) VALUES ('$v', '$f', '$sum', 'no-tx', 0);
\\endif
SELECT pg_advisory_unlock($LOCK_ID);"
  fi
  if ! echo "$script" | "${PSQL[@]}" -o /dev/null; then
    if [ "$mode" = tx ]; then
      die "$f fallita — annullata completamente (rollback). Le migrazioni successive non sono state applicate."
    else
      die "$f fallita (no-transaction: può aver applicato una parte; è idempotente, correggere e rieseguire)."
    fi
  fi
  q "UPDATE schema_migrations SET duration_ms = $(( $(now_ms) - start )) WHERE version = '$v'" >/dev/null
  log "  ✓ $f ($mode, $(( $(now_ms) - start )) ms)"
done
log "Database aggiornato."

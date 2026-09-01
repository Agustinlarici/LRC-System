#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# Genera una CA locale + certificato server per HTTPS in LAN (senza dominio).
#
# Uso:   ./certs/generate-certs.sh
# Richiede SERVER_IP valorizzato nel .env (IP con cui i browser/tablet
# raggiungono il server, es. 192.168.6.72).
#
# Output in ./certs/:
#   ca-cert.pem               → installala UNA VOLTA sui tablet/PC (CA attendibile)
#   ca-key.pem                → chiave della CA, NON distribuire, NON committare
#   server-cert.pem/-key.pem  → usati da nginx per TLS, NON committare
# ═══════════════════════════════════════════════════════════════════
set -e

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "File .env non trovato. Copia .env.example -> .env e valorizza SERVER_IP." >&2
  exit 1
fi

SERVER_IP="$(grep -E '^SERVER_IP=' .env | cut -d= -f2- | tr -d '[:space:]')"
if [ -z "$SERVER_IP" ]; then
  echo "SERVER_IP non valorizzato nel .env." >&2
  exit 1
fi

OUT=certs
mkdir -p "$OUT"

if [ -f "$OUT/server-cert.pem" ]; then
  echo "Certificati già presenti in $OUT/ per l'IP corrente."
  echo "Per rigenerarli (es. IP cambiato): cancella la cartella certs/ e rilancia questo script."
  exit 0
fi

echo "Genero CA locale e certificato server per $SERVER_IP..."

# ─── CA (root, da installare una volta sui dispositivi) ───────────
openssl genrsa -out "$OUT/ca-key.pem" 4096
openssl req -x509 -new -nodes -key "$OUT/ca-key.pem" -sha256 -days 3650 \
  -subj "/O=LRC System/CN=LRC System Local CA" \
  -out "$OUT/ca-cert.pem"

# ─── Certificato server (IP SAN — niente dominio) ──────────────────
openssl genrsa -out "$OUT/server-key.pem" 2048
openssl req -new -key "$OUT/server-key.pem" \
  -subj "/O=LRC System/CN=$SERVER_IP" \
  -out "$OUT/server.csr"

cat > "$OUT/server-ext.cnf" <<EOF
subjectAltName = IP:$SERVER_IP
extendedKeyUsage = serverAuth
EOF

openssl x509 -req -in "$OUT/server.csr" -CA "$OUT/ca-cert.pem" -CAkey "$OUT/ca-key.pem" \
  -CAcreateserial -out "$OUT/server-cert.pem" -days 1825 -sha256 \
  -extfile "$OUT/server-ext.cnf"

rm -f "$OUT/server.csr" "$OUT/server-ext.cnf" "$OUT/ca-cert.srl"
chmod 600 "$OUT/ca-key.pem" "$OUT/server-key.pem"

echo ""
echo "Fatto. File generati in $OUT/:"
echo "  - ca-cert.pem                      → installa UNA VOLTA sui tablet (CA attendibile)"
echo "  - server-cert.pem / server-key.pem → usati da nginx (non distribuire)"
echo ""
echo "Per installare la CA su un tablet Android:"
echo "  1. Copia certs/ca-cert.pem sul tablet (email, drive, cavo USB...)"
echo "  2. Impostazioni > Sicurezza > Altre impostazioni sicurezza >"
echo "     Crittografia e credenziali > Installa certificato > Certificato CA"
echo "  3. Seleziona ca-cert.pem e conferma"

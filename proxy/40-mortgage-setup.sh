#!/bin/sh
# Runs once when the proxy container starts (nginx image entrypoint hook).
#  1. Makes sure there is a TLS certificate (generates a self-signed one if not).
#  2. Works out how to reach Actual.
#  3. Writes the nginx config.
set -eu

CERT_DIR=/certs
CERT="$CERT_DIR/${TLS_CERT_FILE:-tls.crt}"
KEY="$CERT_DIR/${TLS_KEY_FILE:-tls.key}"

if [ -z "${ACTUAL_UPSTREAM:-}" ]; then
  echo "[mortgage-proxy] ACTUAL_UPSTREAM is not set. Set it in .env (see README)." >&2
  exit 1
fi

# --- 1. certificate ----------------------------------------------------------
if [ ! -s "$CERT" ] || [ ! -s "$KEY" ]; then
  echo "[mortgage-proxy] no certificate at $CERT, generating a self-signed one"
  mkdir -p "$CERT_DIR"
  openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
    -subj "/CN=actual-mortgage-proxy" \
    -addext "subjectAltName=DNS:localhost,DNS:actual,IP:127.0.0.1" \
    -keyout "$KEY" -out "$CERT" 2>/dev/null
  chmod 600 "$KEY"
fi

# --- 2. upstream ---------------------------------------------------------------
# nginx re-resolves Docker service names on every request (so an Actual update
# that changes the container's IP just works), but its resolver can't see
# /etc/hosts. Names that only exist there (extra_hosts, used when Actual runs
# outside this compose project) are resolved once, here.
upstream="$ACTUAL_UPSTREAM"
hostport=$(echo "$upstream" | sed -E 's#^[a-z]+://##; s#/.*$##')
host=${hostport%%:*}
ip=$(awk -v h="$host" '$1 !~ /^#/ { for (i = 2; i <= NF; i++) if ($i == h) { print $1; exit } }' /etc/hosts)
if [ -n "$ip" ]; then
  upstream=$(echo "$upstream" | sed "s#://$host#://$ip#")
  echo "[mortgage-proxy] $host is in /etc/hosts, using $ip"
fi

export ACTUAL_UPSTREAM_URL="${upstream%/}"
export MORTGAGE_BACKEND_URL="${MORTGAGE_BACKEND:-http://mortgage-backend:3100}"
export TLS_CERT="$CERT" TLS_KEY="$KEY"

# --- 3. config -------------------------------------------------------------------
envsubst '${ACTUAL_UPSTREAM_URL} ${MORTGAGE_BACKEND_URL} ${TLS_CERT} ${TLS_KEY}' \
  < /etc/mortgage/nginx.conf.template > /etc/nginx/conf.d/mortgage.conf
echo "[mortgage-proxy] Actual upstream: $ACTUAL_UPSTREAM_URL  backend: $MORTGAGE_BACKEND_URL"

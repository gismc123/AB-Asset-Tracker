#!/bin/sh
# Runs once when the proxy container starts (nginx image entrypoint hook).
#  1. Makes sure there is a TLS certificate (generates a self-signed one if not),
#     unless PROXY_TLS=off because something in front (a Cloudflare Tunnel, a
#     reverse proxy) already handles HTTPS.
#  2. Works out how to reach Actual.
#  3. Writes the nginx config.
set -eu

CERT_DIR=/certs
CERT="$CERT_DIR/${TLS_CERT_FILE:-tls.crt}"
KEY="$CERT_DIR/${TLS_KEY_FILE:-tls.key}"
PROXY_TLS="${PROXY_TLS:-on}"

if [ -z "${ACTUAL_UPSTREAM:-}" ]; then
  echo "[asset-tracker-proxy] ACTUAL_UPSTREAM is not set. Set it in .env (see README)." >&2
  exit 1
fi
case "$PROXY_TLS" in
  on | off) ;;
  *)
    echo "[asset-tracker-proxy] PROXY_TLS must be on or off, not \"$PROXY_TLS\"." >&2
    exit 1
    ;;
esac

# --- 1. certificate ----------------------------------------------------------
if [ "$PROXY_TLS" = on ] && { [ ! -s "$CERT" ] || [ ! -s "$KEY" ]; }; then
  echo "[asset-tracker-proxy] no certificate at $CERT, generating a self-signed one"
  mkdir -p "$CERT_DIR"
  openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
    -subj "/CN=ab-asset-tracker-proxy" \
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
  echo "[asset-tracker-proxy] $host is in /etc/hosts, using $ip"
fi

export ACTUAL_UPSTREAM_URL="${upstream%/}"
export TRACKER_BACKEND_URL="${TRACKER_BACKEND:-http://asset-tracker-backend:3100}"

# --- 3. config -------------------------------------------------------------------
if [ "$PROXY_TLS" = on ]; then
  LISTEN="listen 8443 ssl;
  http2 on;
  ssl_certificate     $CERT;
  ssl_certificate_key $KEY;
  ssl_protocols TLSv1.2 TLSv1.3;"
  # The browser talks to us, over HTTPS.
  FORWARDED_PROTO=https
else
  # Plain HTTP for whatever is in front; it tells us how the browser connected.
  LISTEN="listen 8443;"
  FORWARDED_PROTO='$forwarded_proto'
fi
export LISTEN FORWARDED_PROTO
envsubst '${ACTUAL_UPSTREAM_URL} ${TRACKER_BACKEND_URL} ${LISTEN} ${FORWARDED_PROTO}' \
  < /etc/asset-tracker/nginx.conf.template > /etc/nginx/conf.d/asset-tracker.conf
echo "[asset-tracker-proxy] TLS: $PROXY_TLS  Actual upstream: $ACTUAL_UPSTREAM_URL  backend: $TRACKER_BACKEND_URL"
if [ "$PROXY_TLS" = off ]; then
  echo "[asset-tracker-proxy] serving plain HTTP: open Actual through the HTTPS address in front (e.g. your Cloudflare Tunnel hostname)"
fi

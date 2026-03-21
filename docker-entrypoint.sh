#!/bin/sh
set -e

echo "=== hubport.cloud startup ==="

# Sync database schema (idempotent — applies any new columns/tables)
if [ -d "/app/hub-api/prisma" ]; then
  echo "[db] Syncing schema..."
  cd /app/hub-api && npx prisma db push --accept-data-loss 2>&1 || echo "[db] Schema sync failed — starting anyway"
  cd /app
fi

# Generate runtime config for hub-app (resolves VITE_ build-time limitation)
if [ -d "/app/hub-app/dist" ]; then
  KC_URL="${KEYCLOAK_URL:-}"
  # For browser access, Keycloak URL must be reachable from the client (not internal Docker DNS)
  KC_BROWSER_URL="${KEYCLOAK_BROWSER_URL:-${KC_URL}}"
  CHAT_URL=""
  JITSI_URL=""
  if [ -n "${WEBAUTHN_RP_ID:-}" ]; then
    CHAT_URL="https://chat-${WEBAUTHN_RP_ID}"
    JITSI_URL="${JITSI_URL:-https://meet-${WEBAUTHN_RP_ID}}"
  fi
  cat > /app/hub-app/dist/runtime-config.js << EOF
window.__HUBPORT_CONFIG__ = {
  keycloakUrl: "${KC_BROWSER_URL}",
  keycloakRealm: "hubport",
  keycloakClientId: "hub-app",
  apiUrl: "${HUB_API_URL:-http://localhost:3001}",
  rpId: "${WEBAUTHN_RP_ID:-}",
  chatUrl: "${CHAT_URL}",
  jitsiUrl: "${JITSI_URL}"
};
EOF
  # Inject runtime-config.js script tag if Vite stripped it during build
  if ! grep -q 'runtime-config.js' /app/hub-app/dist/index.html 2>/dev/null; then
    sed -i 's|<title>|<script src="/runtime-config.js"></script>\n    <title>|' /app/hub-app/dist/index.html
    echo "[config] Injected runtime-config.js script tag into index.html"
  fi
  # Prevent Cloudflare from caching runtime-config.js (it changes per container start)
  cat > /app/hub-app/dist/serve.json << 'SERVEJSON'
{
  "headers": [
    { "source": "runtime-config.js", "headers": [{ "key": "Cache-Control", "value": "no-store, no-cache, must-revalidate" }] }
  ]
}
SERVEJSON
  echo "[config] Runtime config generated for hub-app"
fi

# Start setup wizard on secondary port (always available for reconfiguration)
echo "[wizard] Starting setup wizard on :8080..."
node /app/setup-wizard/dist/index.js &

# Start hub-app (serve static SPA on :3000)
if [ -d "/app/hub-app/dist" ]; then
  echo "[app] Starting hub-app on :3000..."
  npx serve -s /app/hub-app/dist -l 3000 &
fi

# Start hub-api (background, always needed)
if [ -f "/app/hub-api/dist/index.js" ]; then
  echo "[api] Starting hub-api on :3001..."
  node /app/hub-api/dist/index.js &
fi

# Keep container alive
wait

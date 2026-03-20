#!/bin/sh
set -e

echo "=== hubport.cloud startup ==="

# Run Prisma migrations (idempotent)
if [ -d "/app/hub-api/prisma" ]; then
  echo "[db] Running migrations..."
  cd /app/hub-api && npx prisma migrate deploy 2>/dev/null || echo "[db] No migrations to run"
  cd /app
fi

# Generate runtime config for SPA (VITE_ vars are baked at build time,
# so we inject env vars via window.__HUBPORT_CONFIG__ at container start)
if [ -d "/app/hub-app/dist" ]; then
  echo "[config] Generating runtime config..."
  # KEYCLOAK_BROWSER_URL = browser-accessible URL (e.g. http://localhost:8080)
  # KEYCLOAK_URL = internal Docker URL (e.g. http://keycloak:8080) — NOT for browser
  KC_BROWSER="${KEYCLOAK_BROWSER_URL:-${KEYCLOAK_URL:-}}"
  cat > /app/hub-app/dist/config.js <<EOF
window.__HUBPORT_CONFIG__ = {
  KEYCLOAK_URL: "${KC_BROWSER}",
  KEYCLOAK_REALM: "${KEYCLOAK_REALM:-hubport}",
  KEYCLOAK_CLIENT_ID: "${KEYCLOAK_CLIENT_ID:-hub-app}",
  API_URL: "${API_URL:-}"
};
EOF
fi

# Start setup wizard (background)
echo "[wizard] Starting setup wizard on :8080..."
node /app/setup-wizard/dist/index.js &

# Start hub-api (serves API + SPA static files on :3000)
if [ -f "/app/hub-api/dist/index.js" ]; then
  echo "[api] Starting hub-api on :3000..."
  node /app/hub-api/dist/index.js &
fi

# Keep container alive
wait

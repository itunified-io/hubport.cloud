#!/bin/sh
set -e

echo "=== hubport.cloud startup ==="

# Run Prisma migrations (idempotent)
if [ -d "/app/hub-api/prisma" ]; then
  echo "[db] Running migrations..."
  cd /app/hub-api && npx prisma migrate deploy 2>/dev/null || echo "[db] No migrations to run"
  cd /app
fi

# Start setup wizard (background)
echo "[wizard] Starting setup wizard on :8080..."
node /app/setup-wizard/dist/index.js &

# Start hub-api (background)
if [ -f "/app/hub-api/dist/index.js" ]; then
  echo "[api] Starting hub-api on :3001..."
  node /app/hub-api/dist/index.js &
fi

# Start hub-app (serve static SPA)
if [ -d "/app/hub-app/dist" ]; then
  echo "[app] Starting hub-app on :3000..."
  npx serve -s /app/hub-app/dist -l 3000 &
fi

# Keep container alive
wait

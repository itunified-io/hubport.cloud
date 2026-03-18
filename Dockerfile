# hubport.cloud — Multi-stage Docker build
# Bundles: hub-app (React SPA) + hub-api (Fastify) + setup-wizard

FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies for all workspaces
COPY package*.json ./
COPY hub-app/package*.json ./hub-app/
COPY hub-api/package*.json ./hub-api/
COPY setup-wizard/package*.json ./setup-wizard/
COPY central-api/package*.json ./central-api/
RUN npm ci --workspace=hub-app --workspace=hub-api --workspace=setup-wizard

# Build hub-app (React SPA)
COPY hub-app/ ./hub-app/
RUN npm run build --workspace=hub-app 2>/dev/null || echo "hub-app: no build script yet (placeholder)"

# Build hub-api
COPY hub-api/ ./hub-api/
RUN npm run build --workspace=hub-api 2>/dev/null || echo "hub-api: no build script yet (placeholder)"

# Build setup-wizard
COPY setup-wizard/ ./setup-wizard/
RUN npm run build --workspace=setup-wizard 2>/dev/null || echo "setup-wizard: no build script yet (placeholder)"

# Generate Prisma client
COPY hub-api/prisma ./hub-api/prisma/ 2>/dev/null || true
RUN cd hub-api && npx prisma generate 2>/dev/null || true

# --- Runtime ---
FROM node:20-alpine AS runtime
WORKDIR /app

RUN addgroup -g 1001 hubport && adduser -u 1001 -G hubport -s /bin/sh -D hubport

# Copy built artifacts
COPY --from=builder /app/hub-app/dist ./hub-app/dist/ 2>/dev/null || true
COPY --from=builder /app/hub-api/dist ./hub-api/dist/ 2>/dev/null || true
COPY --from=builder /app/hub-api/prisma ./hub-api/prisma/ 2>/dev/null || true
COPY --from=builder /app/setup-wizard/dist ./setup-wizard/dist/
COPY --from=builder /app/node_modules ./node_modules/
COPY --from=builder /app/package.json ./

# Run Prisma migrations on startup, then start all services
COPY docker-entrypoint.sh /app/
RUN chmod +x /app/docker-entrypoint.sh

USER hubport
EXPOSE 3000 3001 8080

ENTRYPOINT ["/app/docker-entrypoint.sh"]

# hubport.cloud — Multi-stage Docker build
# Bundles: hub-app (React SPA) + hub-api (Fastify) + setup-wizard

FROM node:20-alpine AS builder
WORKDIR /app

# Copy all package files for workspace install
COPY package*.json ./
COPY hub-app/package*.json ./hub-app/
COPY hub-api/package*.json ./hub-api/
COPY setup-wizard/package*.json ./setup-wizard/
COPY central-api/package*.json ./central-api/
RUN npm ci

# Copy source and build hub-api (Prisma + TypeScript)
COPY hub-api/ ./hub-api/
RUN cd hub-api && npx prisma generate && npm run build

# Copy source and build hub-app (Vite SPA)
COPY hub-app/ ./hub-app/
RUN npm run build --workspace=hub-app

# Copy source and build setup-wizard
COPY setup-wizard/ ./setup-wizard/
RUN npm run build --workspace=setup-wizard

# --- Runtime ---
FROM node:20-alpine AS runtime
WORKDIR /app

RUN addgroup -g 1001 hubport && adduser -u 1001 -G hubport -s /bin/sh -D hubport

# Copy built artifacts (chown to hubport user for runtime config injection)
COPY --from=builder --chown=1001:1001 /app/hub-app/dist ./hub-app/dist/
COPY --from=builder /app/hub-api/dist ./hub-api/dist/
COPY --from=builder /app/hub-api/prisma ./hub-api/prisma/
COPY --from=builder /app/setup-wizard/dist ./setup-wizard/dist/
COPY --from=builder /app/node_modules ./node_modules/
COPY --from=builder /app/package.json ./

# Entrypoint: auto-migrate + start all services
COPY docker-entrypoint.sh /app/
RUN chmod +x /app/docker-entrypoint.sh

USER hubport
EXPOSE 3000 8080

ENTRYPOINT ["/app/docker-entrypoint.sh"]

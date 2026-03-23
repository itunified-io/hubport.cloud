# hubport.cloud — Multi-stage Docker build
# Bundles: hub-app (React SPA) + hub-api (Fastify) + setup-wizard

FROM node:20-alpine AS builder
WORKDIR /app

ARG TARGETOS=linux
ARG TARGETARCH
ENV npm_config_os=$TARGETOS
ENV npm_config_cpu=$TARGETARCH
ENV npm_config_libc=musl

# Copy all package files for workspace install
COPY package*.json ./
COPY hub-app/package*.json ./hub-app/
COPY hub-api/package*.json ./hub-api/
COPY setup-wizard/package*.json ./setup-wizard/
COPY central-api/package*.json ./central-api/
RUN npm ci --include=optional \
 && case "$TARGETARCH" in \
      amd64) ROLLUP_ARCH="x64" ;; \
      arm64) ROLLUP_ARCH="arm64" ;; \
      *) echo "Unsupported TARGETARCH for Rollup native package: $TARGETARCH" >&2; exit 1 ;; \
    esac \
 && ROLLUP_VERSION="$(node -p "require('./package-lock.json').packages['node_modules/rollup'].version")" \
 && LIGHTNINGCSS_VERSION="$(node -p "require('./package-lock.json').packages['node_modules/lightningcss'].version")" \
 && TAILWIND_OXIDE_VERSION="$(node -p "require('./package-lock.json').packages['node_modules/@tailwindcss/oxide'].version")" \
 && npm install --no-save \
      "@rollup/rollup-linux-${ROLLUP_ARCH}-musl@${ROLLUP_VERSION}" \
      "lightningcss-linux-${ROLLUP_ARCH}-musl@${LIGHTNINGCSS_VERSION}" \
      "@tailwindcss/oxide-linux-${ROLLUP_ARCH}-musl@${TAILWIND_OXIDE_VERSION}"

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

# Copy built artifacts
COPY --from=builder /app/hub-app/dist ./hub-app/dist/
COPY --from=builder /app/hub-api/dist ./hub-api/dist/
COPY --from=builder /app/hub-api/prisma ./hub-api/prisma/
COPY --from=builder /app/setup-wizard/dist ./setup-wizard/dist/
COPY --from=builder /app/node_modules ./node_modules/
COPY --from=builder /app/package.json ./

# Allow runtime user to write runtime-config.js into hub-app/dist
RUN chown -R hubport:hubport /app/hub-app/dist

# Entrypoint: auto-migrate + start all services
COPY docker-entrypoint.sh /app/
RUN chmod +x /app/docker-entrypoint.sh

USER hubport
EXPOSE 3000 3001 8080

ENTRYPOINT ["/app/docker-entrypoint.sh"]

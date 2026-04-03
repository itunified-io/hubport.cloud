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
      amd64) BUILD_ARCH="x64" ;; \
      arm64) BUILD_ARCH="arm64" ;; \
      *) echo "Unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
    esac \
 && LIGHTNINGCSS_VERSION="$(node -p "require('./package-lock.json').packages['node_modules/lightningcss'].version")" \
 && TAILWIND_OXIDE_VERSION="$(node -p "require('./package-lock.json').packages['node_modules/@tailwindcss/oxide'].version")" \
 && ROLLDOWN_VERSION="$(node -p "require('./package-lock.json').packages['node_modules/rolldown']?.version || ''")" \
 && NATIVE_PKGS="" \
 && NATIVE_PKGS="$NATIVE_PKGS lightningcss-linux-${BUILD_ARCH}-musl@${LIGHTNINGCSS_VERSION}" \
 && NATIVE_PKGS="$NATIVE_PKGS @tailwindcss/oxide-linux-${BUILD_ARCH}-musl@${TAILWIND_OXIDE_VERSION}" \
 && if [ -n "$ROLLDOWN_VERSION" ]; then NATIVE_PKGS="$NATIVE_PKGS @rolldown/binding-linux-${BUILD_ARCH}-musl@${ROLLDOWN_VERSION}"; fi \
 && ROLLUP_VERSION="$(node -p "require('./package-lock.json').packages['node_modules/rollup']?.version || ''")" \
 && if [ -n "$ROLLUP_VERSION" ]; then NATIVE_PKGS="$NATIVE_PKGS @rollup/rollup-linux-${BUILD_ARCH}-musl@${ROLLUP_VERSION}"; fi \
 && npm install --no-save $NATIVE_PKGS

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

# Chromium for server-side PDF map rendering (Puppeteer)
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

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

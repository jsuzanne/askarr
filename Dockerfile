# ==============================================================================
# Askarr — Multi-Stage Production Dockerfile (Port 4880)
# Cible : NucVillers (/storage/Docker/Askarr)
# ==============================================================================

# Étape 1 : Build Frontend (Vite + React) & Backend (TypeScript + better-sqlite3)
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Outils requis pour compiler le module natif better-sqlite3 si pré-build absent
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.server.json vite.config.ts index.html ./
COPY src ./src

RUN npm run build
RUN npm prune --omit=dev

# Étape 2 : Runtime de Production Léger
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4880
ENV SQLITE_DB_PATH=/app/data/askarr.db

# Créer le dossier de persistance SQLite (/storage/Docker/Askarr/data monté sur /app/data)
RUN mkdir -p /app/data && chown -R node:node /app

COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist

USER node

EXPOSE 4880

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4880/api/health/live').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/server/index.js"]

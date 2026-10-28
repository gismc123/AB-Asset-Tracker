# AB Asset Tracker backend + built UI bundle.
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Toolchain for better-sqlite3 in case no prebuilt binary matches this platform.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3100 DATA_DIR=/data UI_DIR=/app/dist/ui
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN mkdir -p /data && chown node:node /data
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3100)+'/asset-tracker-api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# Docker creates a missing ./data bind mount owned by root, so take ownership
# of it first, then drop to the unprivileged "node" user for the actual service.
CMD ["sh", "-c", "chown node:node /data 2>/dev/null; exec setpriv --reuid=node --regid=node --init-groups node dist/server/index.js"]

# syntax=docker/dockerfile:1
FROM node:24.15-bookworm-slim AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY jobs/dining-sync/package.json ./jobs/dining-sync/package.json
COPY packages/domains/dining/package.json ./packages/domains/dining/package.json

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store,sharing=locked \
  --mount=type=cache,id=corepack,target=/root/.cache/node/corepack,sharing=locked \
  corepack enable pnpm \
  && pnpm install --frozen-lockfile --filter dining-sync...

COPY jobs/dining-sync ./jobs/dining-sync
COPY packages/domains/dining ./packages/domains/dining

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store,sharing=locked \
  pnpm --filter dining-sync typecheck \
  && pnpm --filter dining-sync build:runtime \
  && pnpm --filter dining-sync deploy --legacy --prod /opt/dining-sync \
  && test ! -e /opt/dining-sync/node_modules/.bin/tsx \
  && test -f /opt/dining-sync/migrations/0001_dining.sql \
  && test -f /opt/dining-sync/dist/cli.mjs \
  && node --enable-source-maps /opt/dining-sync/dist/cli.mjs native-entrypoint-smoke 2>&1 \
    | grep -F "Usage: pnpm sync"

FROM node:24.15-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
  && apt-get upgrade -y \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/corepack /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/pnpm /usr/local/bin/pnpx

COPY --from=build --chown=node:node /opt/dining-sync /app/jobs/dining-sync

USER node

ENTRYPOINT ["node", "--enable-source-maps", "/app/jobs/dining-sync/dist/cli.mjs"]
CMD ["sync-all"]

# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM node:24.15-bookworm-slim AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/ops-web/package.json ./apps/ops-web/package.json
COPY packages/domains/dining/package.json ./packages/domains/dining/package.json

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store,sharing=locked \
  --mount=type=cache,id=corepack,target=/root/.cache/node/corepack,sharing=locked \
  corepack enable pnpm \
  && pnpm install --frozen-lockfile --filter 'ops-web...'

COPY apps/ops-web ./apps/ops-web
COPY packages/domains/dining ./packages/domains/dining

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store,sharing=locked \
  pnpm --filter ops-web build \
  && pnpm --filter ops-web deploy --legacy --prod /opt/ops-web

FROM node:24.15-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production \
  PORT=5178

RUN apt-get update \
  && apt-get upgrade -y \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/corepack /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/pnpm /usr/local/bin/pnpx

COPY --from=build --chown=node:node /opt/ops-web ./

USER node

EXPOSE 5178

CMD ["node", "dist-server/node.js"]

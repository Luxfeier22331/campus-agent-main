# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM node:24.18.1-bookworm-slim AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/ops-web/package.json ./apps/ops-web/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/domains/dining/package.json ./packages/domains/dining/package.json
COPY packages/internal-portal-client/package.json ./packages/internal-portal-client/package.json
COPY packages/langfuse-identity/package.json ./packages/langfuse-identity/package.json
COPY packages/ui/package.json ./packages/ui/package.json
COPY scripts/release/check-ops-web-artifact.mjs ./scripts/release/check-ops-web-artifact.mjs

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store,sharing=locked \
  --mount=type=cache,id=corepack,target=/root/.cache/node/corepack,sharing=locked \
  corepack enable pnpm \
  && pnpm install --frozen-lockfile --filter 'ops-web...'

COPY apps/ops-web ./apps/ops-web
COPY configs/sources/internal-portal.json ./configs/sources/internal-portal.json
COPY packages/contracts ./packages/contracts
COPY packages/domains/dining ./packages/domains/dining
COPY packages/internal-portal-client ./packages/internal-portal-client
COPY packages/langfuse-identity ./packages/langfuse-identity
COPY packages/ui ./packages/ui

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store,sharing=locked \
  pnpm --filter ops-web build \
  && pnpm --filter ops-web deploy --legacy --prod /opt/ops-web \
  && node scripts/release/check-ops-web-artifact.mjs /opt/ops-web

FROM node:24.18.1-bookworm-slim AS runtime

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

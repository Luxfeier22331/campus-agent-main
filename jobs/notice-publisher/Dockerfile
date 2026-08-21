# syntax=docker/dockerfile:1
ARG NODE_VERSION
FROM node:${NODE_VERSION}-bookworm-slim AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY jobs/notice-publisher/package.json ./jobs/notice-publisher/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/domains/notices/package.json ./packages/domains/notices/package.json
COPY packages/ingestion-contracts/package.json ./packages/ingestion-contracts/package.json

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store,sharing=locked \
  --mount=type=cache,id=corepack,target=/root/.cache/node/corepack,sharing=locked \
  corepack enable pnpm \
  && pnpm install --frozen-lockfile --filter notice-publisher...

COPY configs/sources/internal-portal.json ./configs/sources/internal-portal.json
COPY jobs/notice-publisher/src ./jobs/notice-publisher/src
COPY packages/contracts/src ./packages/contracts/src
COPY packages/domains/notices/src ./packages/domains/notices/src
COPY packages/ingestion-contracts/schemas ./packages/ingestion-contracts/schemas
COPY packages/ingestion-contracts/src ./packages/ingestion-contracts/src

RUN pnpm --filter notice-publisher build

FROM node:${NODE_VERSION}-bookworm-slim AS production-dependencies

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY jobs/notice-publisher/package.json ./jobs/notice-publisher/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/domains/notices/package.json ./packages/domains/notices/package.json
COPY packages/ingestion-contracts/package.json ./packages/ingestion-contracts/package.json

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store,sharing=locked \
  --mount=type=cache,id=corepack,target=/root/.cache/node/corepack,sharing=locked \
  corepack enable pnpm \
  && pnpm install --prod --frozen-lockfile --filter notice-publisher...

FROM node:${NODE_VERSION}-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

LABEL org.opencontainers.image.source="https://github.com/MUC-WIKI/campus-agent" \
  org.opencontainers.image.title="campus-agent-notice-publisher" \
  org.opencontainers.image.description="One-shot normalized notice publisher"

RUN apt-get update \
  && apt-get upgrade -y \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/corepack /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/pnpm /usr/local/bin/pnpx

COPY --from=production-dependencies --chown=node:node /app /app
COPY --from=build --chown=node:node /app/jobs/notice-publisher/dist /app/jobs/notice-publisher/dist
COPY --chown=node:node jobs/notice-publisher/migrations /app/jobs/notice-publisher/migrations

RUN node --input-type=module -e "import('./jobs/notice-publisher/dist/cli.js')"

USER node
ENTRYPOINT ["node", "jobs/notice-publisher/dist/cli.js"]

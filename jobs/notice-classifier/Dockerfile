# syntax=docker/dockerfile:1
ARG NODE_VERSION
FROM node:${NODE_VERSION}-bookworm-slim AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY jobs/notice-classifier/package.json ./jobs/notice-classifier/package.json
COPY packages/notice-classifier-core/package.json ./packages/notice-classifier-core/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/domains/notices/package.json ./packages/domains/notices/package.json

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store,sharing=locked \
  --mount=type=cache,id=corepack,target=/root/.cache/node/corepack,sharing=locked \
  corepack enable pnpm \
  && pnpm install --frozen-lockfile --filter notice-classifier...

COPY jobs/notice-classifier/tsconfig.json ./jobs/notice-classifier/tsconfig.json
COPY jobs/notice-classifier/src ./jobs/notice-classifier/src
COPY packages/notice-classifier-core/src ./packages/notice-classifier-core/src
COPY packages/contracts/src ./packages/contracts/src
COPY packages/domains/notices/src ./packages/domains/notices/src

RUN pnpm --filter notice-classifier build

FROM node:${NODE_VERSION}-bookworm-slim AS production-dependencies

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY jobs/notice-classifier/package.json ./jobs/notice-classifier/package.json
COPY packages/notice-classifier-core/package.json ./packages/notice-classifier-core/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/domains/notices/package.json ./packages/domains/notices/package.json

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store,sharing=locked \
  --mount=type=cache,id=corepack,target=/root/.cache/node/corepack,sharing=locked \
  corepack enable pnpm \
  && pnpm install --prod --frozen-lockfile --filter notice-classifier...

FROM node:${NODE_VERSION}-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production

LABEL org.opencontainers.image.source="https://github.com/MUC-WIKI/campus-agent" \
  org.opencontainers.image.title="campus-agent-notice-classifier" \
  org.opencontainers.image.description="One-shot title-only notice classification job"

RUN apt-get update \
  && apt-get upgrade -y \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/corepack /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/pnpm /usr/local/bin/pnpx

COPY --from=production-dependencies --chown=node:node /app /app
COPY --from=build --chown=node:node /app/jobs/notice-classifier/dist /app/jobs/notice-classifier/dist

RUN node --input-type=module -e "import('./jobs/notice-classifier/dist/cli.js')"

USER node

ENTRYPOINT ["node", "jobs/notice-classifier/dist/cli.js"]

# syntax=docker/dockerfile:1
ARG NODE_VERSION
FROM node:${NODE_VERSION}-bookworm-slim AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY jobs/campus-agent-schema/package.json ./jobs/campus-agent-schema/package.json

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store,sharing=locked \
  --mount=type=cache,id=corepack,target=/root/.cache/node/corepack,sharing=locked \
  corepack enable pnpm \
  && pnpm install --frozen-lockfile --filter campus-agent-schema...

COPY jobs/campus-agent-schema/src ./jobs/campus-agent-schema/src
COPY jobs/campus-agent-schema/tsconfig.json ./jobs/campus-agent-schema/tsconfig.json
COPY jobs/campus-agent-schema/migrations ./jobs/campus-agent-schema/migrations

RUN pnpm --filter campus-agent-schema build

FROM node:${NODE_VERSION}-bookworm-slim AS dependencies

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY jobs/campus-agent-schema/package.json ./jobs/campus-agent-schema/package.json

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store,sharing=locked \
  --mount=type=cache,id=corepack,target=/root/.cache/node/corepack,sharing=locked \
  corepack enable pnpm \
  && pnpm install --prod --frozen-lockfile --no-optional --filter campus-agent-schema...

FROM node:${NODE_VERSION}-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

LABEL org.opencontainers.image.source="https://github.com/MUC-WIKI/campus-agent" \
  org.opencontainers.image.title="campus-agent-schema" \
  org.opencontainers.image.description="One-shot unified campus-agent PostgreSQL schema migration"

RUN apt-get update \
  && apt-get upgrade -y \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/corepack /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/pnpm /usr/local/bin/pnpx

COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=dependencies --chown=node:node /app/jobs/campus-agent-schema/package.json ./jobs/campus-agent-schema/package.json
COPY --from=build --chown=node:node /app/jobs/campus-agent-schema/dist ./jobs/campus-agent-schema/dist
COPY --from=build --chown=node:node /app/jobs/campus-agent-schema/migrations ./jobs/campus-agent-schema/migrations

RUN node --check ./jobs/campus-agent-schema/dist/cli.js

USER node

ENTRYPOINT ["node", "jobs/campus-agent-schema/dist/cli.js"]
CMD ["migrate"]

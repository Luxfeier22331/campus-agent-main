# syntax=docker/dockerfile:1
FROM node:24.19.0-bookworm-slim AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY jobs/app-api-schema/package.json ./jobs/app-api-schema/package.json

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store,sharing=locked \
  --mount=type=cache,id=corepack,target=/root/.cache/node/corepack,sharing=locked \
  corepack enable pnpm \
  && pnpm install --frozen-lockfile --filter app-api-schema...

COPY apps/app-api/drizzle ./apps/app-api/drizzle
COPY apps/app-api/ops/db ./apps/app-api/ops/db
COPY apps/app-api/package.json ./apps/app-api/package.json
COPY apps/app-api/src/script-support/shared-db ./apps/app-api/src/script-support/shared-db

RUN ln -s ../../jobs/app-api-schema/node_modules apps/app-api/node_modules \
  && jobs/app-api-schema/node_modules/.bin/esbuild \
    apps/app-api/ops/db/schema.ts \
    --bundle \
    --format=esm \
    --outfile=apps/app-api/ops/db/schema.js \
    --packages=external \
    --platform=node \
    --target=node24 \
  && node -e "import('./apps/app-api/ops/db/schema.js')"

FROM node:24.19.0-bookworm-slim AS dependencies

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY jobs/app-api-schema/package.json ./jobs/app-api-schema/package.json

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store,sharing=locked \
  --mount=type=cache,id=corepack,target=/root/.cache/node/corepack,sharing=locked \
  corepack enable pnpm \
  && pnpm install --frozen-lockfile --prod --no-optional --filter app-api-schema...

FROM node:24.19.0-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
LABEL org.opencontainers.image.source="https://github.com/MUC-WIKI/campus-agent" \
  org.opencontainers.image.title="campus-agent-app-api-schema" \
  org.opencontainers.image.description="One-shot app-api PostgreSQL schema installer"

RUN apt-get update \
  && apt-get upgrade -y \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/corepack /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/pnpm /usr/local/bin/pnpx

COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=dependencies --chown=node:node /app/jobs/app-api-schema ./jobs/app-api-schema
COPY --chown=node:node apps/app-api/drizzle ./apps/app-api/drizzle
COPY --chown=node:node apps/app-api/package.json ./apps/app-api/package.json
COPY --from=build --chown=node:node /app/apps/app-api/ops/db/schema.js ./apps/app-api/ops/db/schema.js

RUN ln -s ../../jobs/app-api-schema/node_modules apps/app-api/node_modules

USER node

ENTRYPOINT ["node", "apps/app-api/ops/db/schema.js"]

# syntax=docker/dockerfile:1
FROM node:24.15-bookworm-slim AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY jobs/transport-publisher/package.json ./jobs/transport-publisher/package.json

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store,sharing=locked \
  --mount=type=cache,id=corepack,target=/root/.cache/node/corepack,sharing=locked \
  corepack enable pnpm \
  && pnpm install --frozen-lockfile --filter transport-publisher...

COPY jobs/transport-publisher ./jobs/transport-publisher
COPY apps/app-api/db/shared-product-schema/campus_services.sql ./apps/app-api/db/shared-product-schema/campus_services.sql
COPY packages/contracts/schemas/transport-schedule-status.v1.schema.json ./packages/contracts/schemas/transport-schedule-status.v1.schema.json

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store,sharing=locked \
  pnpm --filter transport-publisher deploy --legacy --prod --no-optional /opt/transport-publisher

FROM node:24.15-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
  && apt-get upgrade -y \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/corepack /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/pnpm /usr/local/bin/pnpx

COPY --from=build --chown=node:node /opt/transport-publisher ./jobs/transport-publisher
COPY --chown=node:node apps/app-api/db/shared-product-schema/campus_services.sql ./apps/app-api/db/shared-product-schema/campus_services.sql
COPY --chown=node:node packages/contracts/schemas/transport-schedule-status.v1.schema.json ./packages/contracts/schemas/transport-schedule-status.v1.schema.json

USER node

ENTRYPOINT ["node", "/app/jobs/transport-publisher/src/cli.ts"]

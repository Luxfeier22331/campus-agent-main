# syntax=docker/dockerfile:1
ARG NODE_VERSION=24.21.0

FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-bookworm-slim AS pruner

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true

WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked \
  --mount=type=cache,id=corepack,target=/root/.cache/node/corepack,sharing=locked \
  corepack enable pnpm \
  && pnpm install --ignore-scripts --frozen-lockfile --filter campus-agent-web-workspace

COPY . .

RUN ./node_modules/.bin/turbo prune ops-web --docker --out-dir=/repo/out

FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true

WORKDIR /app

COPY --from=pruner /repo/out/json/ ./

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked \
  --mount=type=cache,id=corepack,target=/root/.cache/node/corepack,sharing=locked \
  corepack enable pnpm \
  && pnpm install --ignore-scripts --frozen-lockfile --filter ops-web...

COPY --from=pruner /repo/out/full/ ./
COPY configs/sources/internal-portal.json ./configs/sources/internal-portal.json
COPY scripts/release/check-ops-web-artifact.mjs ./scripts/release/check-ops-web-artifact.mjs

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked \
  --mount=type=cache,id=corepack,target=/root/.cache/node/corepack,sharing=locked \
  pnpm --filter ops-web build \
  && PNPM_CONFIG_IGNORE_SCRIPTS=true pnpm --filter ops-web deploy --legacy --prod /opt/ops-web \
  && node scripts/release/check-ops-web-artifact.mjs /opt/ops-web

FROM node:${NODE_VERSION}-bookworm-slim AS runtime

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

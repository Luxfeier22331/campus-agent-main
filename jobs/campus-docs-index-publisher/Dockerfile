# syntax=docker/dockerfile:1
ARG NODE_VERSION=24.19.0

FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-bookworm-slim AS pruner

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true

WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store,sharing=locked \
  --mount=type=cache,id=corepack,target=/root/.cache/node/corepack,sharing=locked \
  corepack enable pnpm \
  && pnpm install --ignore-scripts --frozen-lockfile --filter campus-agent-web-workspace

COPY . .

RUN ./node_modules/.bin/turbo prune campus-docs-index-publisher --docker --out-dir=/repo/out

FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true

WORKDIR /app

COPY --from=pruner /repo/out/json/ ./

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store,sharing=locked \
  --mount=type=cache,id=corepack,target=/root/.cache/node/corepack,sharing=locked \
  corepack enable pnpm \
  && pnpm install --ignore-scripts --frozen-lockfile --filter campus-docs-index-publisher...

COPY --from=pruner /repo/out/full/ ./
COPY apps/campus-web/src/docs-reader-build ./apps/campus-web/src/docs-reader-build
COPY apps/campus-web/src/features/docs/version.ts ./apps/campus-web/src/features/docs/version.ts
COPY packages/contracts/schemas ./packages/contracts/schemas

RUN pnpm --filter campus-docs-index-publisher build

FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-bookworm-slim AS production-dependencies

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true

WORKDIR /app

COPY --from=pruner /repo/out/json/ ./

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store,sharing=locked \
  --mount=type=cache,id=corepack,target=/root/.cache/node/corepack,sharing=locked \
  corepack enable pnpm \
  && pnpm install --ignore-scripts --prod --frozen-lockfile --filter campus-docs-index-publisher...

COPY --from=pruner /repo/out/full/packages/embedding-runtime/src ./packages/embedding-runtime/src

FROM node:${NODE_VERSION}-bookworm-slim AS runtime

WORKDIR /app/jobs/campus-docs-index-publisher
ENV NODE_ENV=production

LABEL org.opencontainers.image.source="https://github.com/MUC-WIKI/campus-agent" \
  org.opencontainers.image.title="campus-agent-campus-docs-index-publisher" \
  org.opencontainers.image.description="One-shot Campus Web document index publisher"

RUN apt-get update \
  && apt-get upgrade -y \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/corepack /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/pnpm /usr/local/bin/pnpx

COPY --from=production-dependencies --chown=node:node /app /app
COPY --from=build --chown=node:node /app/jobs/campus-docs-index-publisher/dist ./dist
COPY --from=build --chown=node:node /app/packages/contracts/schemas ./dist/packages/contracts/schemas

RUN node --input-type=module -e "import('./dist/jobs/campus-docs-index-publisher/src/cli.js')"

USER node

ENTRYPOINT ["node", "dist/jobs/campus-docs-index-publisher/src/cli.js"]

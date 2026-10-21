# syntax=docker/dockerfile:1
ARG NODE_VERSION=24.22.1

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
RUN ./node_modules/.bin/turbo prune retrieval-index --docker --out-dir=/repo/out \
  && node --experimental-strip-types scripts/release/prune-image.mts retrieval-index /repo/out

FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true
WORKDIR /app
COPY --from=pruner /repo/out/json/ ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked \
  --mount=type=cache,id=corepack,target=/root/.cache/node/corepack,sharing=locked \
  corepack enable pnpm \
  && pnpm install --ignore-scripts --frozen-lockfile --filter retrieval-index...
COPY --from=pruner /repo/out/full/ ./
COPY packages/contracts/schemas ./packages/contracts/schemas
RUN pnpm --filter retrieval-index build

FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-bookworm-slim AS production-dependencies
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true
WORKDIR /app
COPY --from=pruner /repo/out/json/ ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked \
  --mount=type=cache,id=corepack,target=/root/.cache/node/corepack,sharing=locked \
  corepack enable pnpm \
  && pnpm install --ignore-scripts --prod --frozen-lockfile --filter retrieval-index...

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
WORKDIR /app/jobs/retrieval-index
ENV NODE_ENV=production
LABEL org.opencontainers.image.source="https://github.com/MUC-WIKI/campus-agent" \
  org.opencontainers.image.title="campus-agent-retrieval-index" \
  org.opencontainers.image.description="One-shot unified Campus RAG serving index publisher"
RUN apt-get update \
  && apt-get upgrade -y \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/corepack /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/pnpm /usr/local/bin/pnpx
COPY --from=production-dependencies --chown=node:node /app /app
COPY --from=build --chown=node:node /app/jobs/retrieval-index/dist ./dist
COPY --from=build --chown=node:node /app/packages/contracts/schemas ./dist/packages/contracts/schemas
RUN node --input-type=module -e "import('./dist/cli.js')"
USER node
ENTRYPOINT ["node", "dist/cli.js"]

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
RUN ./node_modules/.bin/turbo prune notice-pipeline-worker --docker --out-dir=/repo/out \
  && node --experimental-strip-types scripts/release/prune-image.mts notice-pipeline-worker /repo/out

FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true
WORKDIR /app
COPY --from=pruner /repo/out/json/ ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked \
  --mount=type=cache,id=corepack,target=/root/.cache/node/corepack,sharing=locked \
  corepack enable pnpm \
  && pnpm install --ignore-scripts --frozen-lockfile --filter notice-pipeline-worker...
COPY --from=pruner /repo/out/full/ ./
COPY packages/contracts/schemas ./packages/contracts/schemas
COPY configs/sources/internal-portal.json ./configs/sources/internal-portal.json
RUN --mount=type=cache,id=corepack,target=/root/.cache/node/corepack,sharing=locked \
  pnpm --filter notice-pipeline-worker build

FROM node:${NODE_VERSION}-bookworm-slim AS production-dependencies
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true
WORKDIR /app
COPY --from=pruner /repo/out/json/ ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked \
  --mount=type=cache,id=corepack,target=/root/.cache/node/corepack,sharing=locked \
  corepack enable pnpm \
  && pnpm install --ignore-scripts --prod --frozen-lockfile --filter notice-pipeline-worker...

FROM node:${NODE_VERSION}-bookworm-slim AS runtime

RUN --mount=type=cache,id=apt-cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,id=apt-lists,target=/var/lib/apt/lists,sharing=locked \
  mv /etc/apt/apt.conf.d/docker-clean /tmp/docker-clean \
  && apt-get update \
  && apt-get upgrade -y \
  && rm -rf /usr/local/lib/node_modules/corepack /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/pnpm /usr/local/bin/pnpx \
  && mv /tmp/docker-clean /etc/apt/apt.conf.d/docker-clean

WORKDIR /app/apps/notice-pipeline-worker
ENV NODE_ENV=production
LABEL org.opencontainers.image.source="https://github.com/MUC-WIKI/campus-agent" \
  org.opencontainers.image.title="campus-agent-notice-pipeline-worker" \
  org.opencontainers.image.description="Temporal worker for the notice collection and RAG pipeline"
COPY --from=production-dependencies --chown=node:node /app /app
COPY --from=build --chown=node:node /app/apps/notice-pipeline-worker/dist ./dist
COPY --from=build --chown=node:node /app/packages/contracts/schemas ./dist/packages/contracts/schemas
RUN node --input-type=module -e "import('@temporalio/worker')"
USER node
ENTRYPOINT ["node"]
CMD ["dist/worker.js"]

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

RUN ./node_modules/.bin/turbo prune agent-runtime --docker --out-dir=/repo/out \
  && node --experimental-strip-types scripts/release/prune-image.mts agent-runtime /repo/out

FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true

WORKDIR /app

COPY --from=pruner /repo/out/json/ ./

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked \
  --mount=type=cache,id=corepack,target=/root/.cache/node/corepack,sharing=locked \
  corepack enable pnpm \
  && pnpm install --ignore-scripts --frozen-lockfile --filter agent-runtime...

COPY --from=pruner /repo/out/full/ ./

RUN --mount=type=cache,id=corepack,target=/root/.cache/node/corepack,sharing=locked \
  pnpm --filter agent-runtime build

FROM node:${NODE_VERSION}-bookworm-slim AS production-dependencies

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true

WORKDIR /app

COPY --from=pruner /repo/out/json/ ./

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked \
  --mount=type=cache,id=corepack,target=/root/.cache/node/corepack,sharing=locked \
  corepack enable pnpm \
  && pnpm install --ignore-scripts --prod --frozen-lockfile --filter agent-runtime...

FROM node:${NODE_VERSION}-bookworm-slim AS runtime

RUN --mount=type=cache,id=apt-cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,id=apt-lists,target=/var/lib/apt/lists,sharing=locked \
  mv /etc/apt/apt.conf.d/docker-clean /tmp/docker-clean \
  && apt-get update \
  && apt-get upgrade -y \
  && rm -rf /usr/local/lib/node_modules/corepack /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/pnpm /usr/local/bin/pnpx \
  && mv /tmp/docker-clean /etc/apt/apt.conf.d/docker-clean

WORKDIR /app
ENV NODE_ENV=production

COPY --from=production-dependencies --chown=node:node /app /app
COPY --from=build --chown=node:node /app/apps/agent-runtime/dist ./apps/agent-runtime/dist
COPY --from=build --chown=node:node /app/packages/contracts/src ./packages/contracts/src
COPY --from=build --chown=node:node /app/packages/contracts/schemas ./packages/contracts/schemas
COPY --chown=node:node configs/runtime/tools.v8.json ./configs/runtime/tools.v8.json
COPY --chown=node:node configs/runtime/tool-function-schemas.v4.json ./configs/runtime/tool-function-schemas.v4.json

USER node

RUN node --input-type=module -e "await import('./packages/contracts/src/agent-runtime-control.ts')"

EXPOSE 8000

CMD ["node", "--network-family-autoselection-attempt-timeout=2000", "apps/agent-runtime/dist/worker.js"]

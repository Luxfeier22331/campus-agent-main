# syntax=docker/dockerfile:1
FROM node:24.19.0-bookworm-slim AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/agent-runtime/package.json ./apps/agent-runtime/package.json

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store,sharing=locked \
  --mount=type=cache,id=corepack,target=/root/.cache/node/corepack,sharing=locked \
  corepack enable pnpm \
  && pnpm install --frozen-lockfile --filter agent-runtime

COPY apps/agent-runtime ./apps/agent-runtime

RUN pnpm --filter agent-runtime build

FROM node:24.19.0-bookworm-slim AS dependencies

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/agent-runtime/package.json ./apps/agent-runtime/package.json

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store,sharing=locked \
  --mount=type=cache,id=corepack,target=/root/.cache/node/corepack,sharing=locked \
  corepack enable pnpm \
  && pnpm install --frozen-lockfile --prod --filter agent-runtime

FROM node:24.19.0-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
  && apt-get upgrade -y \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/corepack /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/pnpm /usr/local/bin/pnpx

COPY --from=dependencies --chown=node:node /app /app
COPY --from=build --chown=node:node /app/apps/agent-runtime/dist ./apps/agent-runtime/dist
COPY --chown=node:node configs/runtime/tools.v6.json ./configs/runtime/tools.v6.json
COPY --chown=node:node configs/runtime/tool-function-schemas.v3.json ./configs/runtime/tool-function-schemas.v3.json

USER node

EXPOSE 27062

CMD ["node", "apps/agent-runtime/dist/server.js"]

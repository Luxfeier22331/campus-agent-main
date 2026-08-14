FROM node:24.18.1-bookworm-slim AS pruner
ENV PNPM_HOME=/pnpm PATH=$PNPM_HOME:$PATH CI=true
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
RUN corepack enable pnpm && pnpm install --frozen-lockfile --filter campus-agent-web-workspace
COPY . .
RUN pnpm exec turbo prune notice-publisher --docker --out-dir=/repo/out

FROM node:24.18.1-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=$PNPM_HOME:$PATH CI=true
WORKDIR /app
COPY --from=pruner /repo/out/json/ ./
RUN corepack enable pnpm && pnpm install --frozen-lockfile --filter notice-publisher...
COPY --from=pruner /repo/out/full/ ./
RUN pnpm --filter notice-publisher typecheck \
  && pnpm --filter notice-publisher build \
  && node --check jobs/notice-publisher/dist/cli.js

FROM node:24.18.1-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
LABEL org.opencontainers.image.source="https://github.com/MUC-WIKI/campus-agent" \
  org.opencontainers.image.title="campus-agent-notice-publisher" \
  org.opencontainers.image.description="Explicit normalized notice publisher and schema installer"

RUN apt-get update \
  && apt-get upgrade -y \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/corepack /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/pnpm /usr/local/bin/pnpx

COPY --from=build --chown=node:node /app/jobs/notice-publisher/dist/cli.js ./jobs/notice-publisher/dist/cli.js
COPY --from=build --chown=node:node /app/jobs/notice-publisher/migrations ./jobs/notice-publisher/migrations

USER node
ENTRYPOINT ["node", "jobs/notice-publisher/dist/cli.js"]

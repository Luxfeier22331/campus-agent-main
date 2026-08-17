# syntax=docker/dockerfile:1
FROM node:24.19.0-bookworm-slim AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY jobs/campus-docs-index-publisher/package.json ./jobs/campus-docs-index-publisher/package.json

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store,sharing=locked \
  --mount=type=cache,id=corepack,target=/root/.cache/node/corepack,sharing=locked \
  corepack enable pnpm \
  && pnpm install --frozen-lockfile --filter campus-docs-index-publisher...

COPY jobs/campus-docs-index-publisher/tsconfig.json ./jobs/campus-docs-index-publisher/tsconfig.json
COPY jobs/campus-docs-index-publisher/tsconfig.build.json ./jobs/campus-docs-index-publisher/tsconfig.build.json
COPY jobs/campus-docs-index-publisher/src ./jobs/campus-docs-index-publisher/src
COPY apps/campus-web/src/docs-reader-build ./apps/campus-web/src/docs-reader-build
COPY packages/contracts/schemas ./packages/contracts/schemas

RUN ln -s ../../jobs/campus-docs-index-publisher/node_modules apps/campus-web/node_modules \
  && pnpm --dir jobs/campus-docs-index-publisher build

FROM node:24.19.0-bookworm-slim AS dependencies

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY jobs/campus-docs-index-publisher/package.json ./jobs/campus-docs-index-publisher/package.json

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store,sharing=locked \
  --mount=type=cache,id=corepack,target=/root/.cache/node/corepack,sharing=locked \
  corepack enable pnpm \
  && pnpm install --frozen-lockfile --prod --filter campus-docs-index-publisher...

FROM node:24.19.0-bookworm-slim AS runtime

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

COPY --from=dependencies --chown=node:node /app /app
COPY --from=build --chown=node:node /app/jobs/campus-docs-index-publisher/dist ./dist
COPY --from=build --chown=node:node /app/packages/contracts/schemas ./dist/packages/contracts/schemas

RUN node --input-type=module -e "import('./dist/jobs/campus-docs-index-publisher/src/cli.js')"

USER node

ENTRYPOINT ["node", "dist/jobs/campus-docs-index-publisher/src/cli.js"]

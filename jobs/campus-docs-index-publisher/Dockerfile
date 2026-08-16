# syntax=docker/dockerfile:1
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
COPY --chown=node:node jobs/campus-docs-index-publisher/src ./src
COPY --chown=node:node apps/campus-web/src/docs-reader-build /app/apps/campus-web/src/docs-reader-build
COPY --chown=node:node packages/contracts/schemas /app/packages/contracts/schemas

RUN ln -s ../../jobs/campus-docs-index-publisher/node_modules /app/apps/campus-web/node_modules

USER node

ENTRYPOINT ["node", "--import", "tsx", "src/cli.ts"]

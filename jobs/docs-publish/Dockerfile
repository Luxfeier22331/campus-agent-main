# syntax=docker/dockerfile:1
FROM node:24.15-bookworm-slim AS dependencies

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY jobs/docs-publish/package.json ./jobs/docs-publish/package.json
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store,sharing=locked \
  --mount=type=cache,id=corepack,target=/root/.cache/corepack,sharing=locked \
  corepack enable pnpm \
  && pnpm install --frozen-lockfile --prod --no-optional --filter docs-publish...

FROM node:24.15-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get upgrade -y \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/corepack /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/pnpm /usr/local/bin/pnpx
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=dependencies --chown=node:node /app/jobs/docs-publish ./jobs/docs-publish
COPY --chown=node:node jobs/docs-publish/src ./jobs/docs-publish/src
COPY --chown=node:node packages/contracts/schemas ./packages/contracts/schemas
USER node
ENTRYPOINT ["node", "jobs/docs-publish/src/cli.ts"]

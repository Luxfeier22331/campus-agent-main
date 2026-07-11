FROM --platform=$BUILDPLATFORM node:24.15-bookworm-slim AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/ops-web/package.json ./apps/ops-web/package.json

RUN npm install --global corepack@0.35.0 \
  && npm cache clean --force \
  && corepack enable pnpm \
  && pnpm install --frozen-lockfile --filter ops-web

COPY apps/ops-web ./apps/ops-web

RUN pnpm --filter ops-web typecheck \
  && pnpm --filter ops-web test \
  && pnpm --filter ops-web build \
  && pnpm --filter ops-web deploy --legacy --prod /opt/ops-web

FROM node:24.15-bookworm-slim AS runtime

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

CMD ["node", "--experimental-strip-types", "src/server/node.ts"]

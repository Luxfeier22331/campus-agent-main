FROM node:24.19.0-bookworm-slim AS pruner

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true

WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN corepack enable pnpm \
  && pnpm install --frozen-lockfile --filter campus-agent-web-workspace

COPY . .

RUN pnpm exec turbo prune ingestion-control --docker --out-dir=/repo/out

FROM node:24.19.0-bookworm-slim AS check

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true

WORKDIR /app

COPY --from=pruner /repo/out/json/ ./

RUN corepack enable pnpm \
  && pnpm install --frozen-lockfile --filter ingestion-control...

COPY --from=pruner /repo/out/full/ ./
COPY configs/sources/internal-portal.json ./configs/sources/internal-portal.json

RUN pnpm --filter ingestion-control typecheck \
  && pnpm --filter ingestion-control build \
  && pnpm --filter ingestion-control check:artifact \
  && touch /check-complete

FROM node:24.19.0-bookworm-slim AS production-tree

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true

WORKDIR /app

COPY --from=check /check-complete /check-complete
COPY --from=pruner /repo/out/json/ ./

RUN corepack enable pnpm \
  && pnpm install --prod --frozen-lockfile --filter ingestion-control...

COPY --from=check /app/apps/ingestion-control/dist ./apps/ingestion-control/dist
COPY --from=pruner /repo/out/full/apps/ingestion-control/migrations ./apps/ingestion-control/migrations
COPY configs/sources/internal-portal.json ./configs/sources/internal-portal.json

FROM node:24.19.0-bookworm-slim AS runtime-base

WORKDIR /app

ENV NODE_ENV=production
ENV HOME=/tmp/ingestion-control-home
ENV XDG_CACHE_HOME=/tmp/ingestion-control-home/.cache

RUN rm -rf \
    /opt/yarn-v* \
    /usr/local/lib/node_modules/npm \
    /usr/local/lib/node_modules/corepack \
  && rm -f \
    /usr/local/bin/npm \
    /usr/local/bin/npx \
    /usr/local/bin/corepack \
    /usr/local/bin/yarn \
    /usr/local/bin/yarnpkg \
    /usr/local/bin/pnpm \
    /usr/local/bin/pnpx

COPY --from=production-tree /app /app

USER node

FROM runtime-base AS api

LABEL org.opencontainers.image.description="ingestion-control credential API"

EXPOSE 8000

CMD ["node", "/app/apps/ingestion-control/dist/server.js"]

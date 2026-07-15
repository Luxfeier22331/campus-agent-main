FROM node:24-bookworm-slim AS pruner

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true

WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN corepack enable pnpm \
  && pnpm install --frozen-lockfile --filter campus-agent-web-workspace

COPY . .

RUN pnpm exec turbo prune source-collector --docker --out-dir=/repo/out

FROM node:24-bookworm-slim AS check

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true

WORKDIR /workspace

COPY --from=pruner /repo/out/json/ ./

RUN corepack enable pnpm \
  && pnpm install --frozen-lockfile --filter source-collector...

COPY --from=pruner /repo/out/full/ ./
COPY configs/ingestion ./configs/ingestion
COPY configs/sources ./configs/sources

RUN pnpm --filter source-collector typecheck \
  && touch /check-complete

FROM node:24-bookworm-slim AS production-dependencies

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true

WORKDIR /workspace

COPY --from=check /check-complete /check-complete
COPY --from=pruner /repo/out/json/ ./

RUN corepack enable pnpm \
  && pnpm install --prod --frozen-lockfile --filter source-collector...

FROM node:24-bookworm-slim AS runtime

WORKDIR /workspace

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV INGESTION_TASK_REGISTRY_ROOT=/workspace/configs/ingestion
ENV OFFICIAL_WEB_CONFIG_ROOT=/workspace/configs/sources/official_web
ENV INTERNAL_PORTAL_RUNTIME_DIR=/tmp/campus-agent/internal-portal
ENV HOME=/tmp/source-collector-home
ENV XDG_CACHE_HOME=/tmp/source-collector-home/.cache
ENV XDG_CONFIG_HOME=/tmp/source-collector-home/.config

COPY --from=production-dependencies /workspace /workspace

# node:slim has bundled Node roots but no system CA bundle; bootstrap Debian HTTPS, then replace it.
RUN node -p 'require("node:tls").rootCertificates.join("\n")' > /tmp/node-root-certificates.crt \
  && sed -i 's#http://deb.debian.org#https://deb.debian.org#g' /etc/apt/sources.list.d/debian.sources \
  && apt-get -o Acquire::https::CaInfo=/tmp/node-root-certificates.crt update \
  && apt-get -o Acquire::https::CaInfo=/tmp/node-root-certificates.crt install \
    -y --no-install-recommends ca-certificates \
  && rm -f /tmp/node-root-certificates.crt \
  && /workspace/apps/source-collector/node_modules/.bin/playwright install-deps chromium \
  && apt-get install -y --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/*

RUN /workspace/apps/source-collector/node_modules/.bin/playwright install \
    --only-shell chromium \
  && rm -rf \
    /opt/yarn-v* \
    /usr/local/lib/node_modules/npm \
    /usr/local/lib/node_modules/corepack \
    /var/lib/apt/lists/* \
  && rm -f \
    /usr/local/bin/npm \
    /usr/local/bin/npx \
    /usr/local/bin/corepack \
    /usr/local/bin/yarn \
    /usr/local/bin/yarnpkg \
    /usr/local/bin/pnpm \
    /usr/local/bin/pnpx

COPY --from=pruner /repo/out/full/ /workspace
COPY configs/ingestion /workspace/configs/ingestion
COPY configs/sources /workspace/configs/sources

RUN install -d -o node -g node /workspace/apps/source-collector/storage

USER node

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/workspace/apps/source-collector/node_modules/.bin/tsx", "/workspace/apps/source-collector/src/temporal-worker.ts"]

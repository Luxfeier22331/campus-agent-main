# syntax=docker/dockerfile:1
ARG NODE_VERSION=24.21.0

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

RUN ./node_modules/.bin/turbo prune internal-portal-collection --docker --out-dir=/repo/out

FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-bookworm-slim AS check

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true

WORKDIR /workspace

COPY --from=pruner /repo/out/json/ ./

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked \
  --mount=type=cache,id=corepack,target=/root/.cache/node/corepack,sharing=locked \
  corepack enable pnpm \
  && pnpm install --ignore-scripts --frozen-lockfile --filter internal-portal-collection...

COPY --from=pruner /repo/out/full/ ./
COPY configs/sources/internal-portal.json ./configs/sources/internal-portal.json

RUN pnpm --filter internal-portal-collection typecheck \
  && pnpm --filter internal-portal-collection build \
  && touch /check-complete

FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-bookworm-slim AS production-dependencies

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true

WORKDIR /workspace

COPY --from=check /check-complete /check-complete
COPY --from=pruner /repo/out/json/ ./

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked \
  --mount=type=cache,id=corepack,target=/root/.cache/node/corepack,sharing=locked \
  corepack enable pnpm \
  && pnpm install --ignore-scripts --prod --frozen-lockfile --filter internal-portal-collection...

FROM node:${NODE_VERSION}-bookworm-slim AS runtime

WORKDIR /workspace

ENV NODE_ENV=production

COPY --from=production-dependencies /workspace /workspace

# node:slim has bundled Node roots but no system CA bundle; bootstrap Debian HTTPS, then replace it.
RUN node -p 'require("node:tls").rootCertificates.join("\n")' > /tmp/node-root-certificates.crt \
  && sed -i 's#http://deb.debian.org#https://deb.debian.org#g' /etc/apt/sources.list.d/debian.sources \
  && apt-get -o Acquire::https::CaInfo=/tmp/node-root-certificates.crt update \
  && apt-get -o Acquire::https::CaInfo=/tmp/node-root-certificates.crt install \
    -y --no-install-recommends ca-certificates \
  && rm -f /tmp/node-root-certificates.crt \
  && apt-get install -y --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/*

RUN rm -rf \
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
COPY --from=check /workspace/jobs/internal-portal-collection/dist /workspace/jobs/internal-portal-collection/dist
COPY configs/sources/internal-portal.json /workspace/configs/sources/internal-portal.json

USER node

ENTRYPOINT ["/usr/bin/tini", "--", "node", "/workspace/jobs/internal-portal-collection/dist/collection-job.js"]
CMD ["--help"]

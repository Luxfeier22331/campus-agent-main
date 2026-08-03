FROM node:24.18.1-bookworm-slim AS pruner

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true

WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN corepack enable pnpm \
  && pnpm install --frozen-lockfile --filter campus-agent-web-workspace

COPY . .

RUN pnpm exec turbo prune ingestion-control --docker --out-dir=/repo/out

FROM node:24.18.1-bookworm-slim AS check

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true

WORKDIR /app

COPY --from=pruner /repo/out/json/ ./

RUN corepack enable pnpm \
  && pnpm install --frozen-lockfile --filter ingestion-control...

COPY --from=pruner /repo/out/full/ ./
COPY configs/ingestion ./configs/ingestion

RUN pnpm --filter ingestion-control typecheck \
  && touch /check-complete

FROM node:24.18.1-bookworm-slim AS production-tree

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true

WORKDIR /app

COPY --from=check /check-complete /check-complete
COPY --from=pruner /repo/out/json/ ./

RUN corepack enable pnpm \
  && pnpm install --prod --frozen-lockfile --filter ingestion-control...

COPY --from=pruner /repo/out/full/ ./
COPY configs/ingestion ./configs/ingestion

FROM rust:1.97.1-bookworm AS rust-kernel-build

WORKDIR /rust-workspace

COPY Cargo.toml Cargo.lock ./
COPY packages/ingestion-kernels-rs ./packages/ingestion-kernels-rs
COPY packages/ingestion-contracts/schemas ./packages/ingestion-contracts/schemas

RUN cargo build --locked -p ingestion-kernels-rs --bin ingestion-kernel-runner --release

FROM python:3.13-slim-bookworm AS tokenizer-download

ENV HF_HOME=/tmp/huggingface
ENV HF_HUB_DISABLE_TELEMETRY=1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1

RUN python -m pip install --no-cache-dir \
    "huggingface_hub==1.23.0" \
    "hf-xet==1.5.1" \
  && hf download Qwen/Qwen3-Embedding-4B tokenizer.json \
    --revision 5cf2132abc99cad020ac570b19d031efec650f2b \
    --local-dir /model \
  && printf '%s\n' "83cdf8c3a34f68862319cb1810ee7b1e2c0a44e0864ae930194ddb76bb7feb8d  /model/tokenizer.json" \
    > /tmp/tokenizer.sha256 \
  && sha256sum -c /tmp/tokenizer.sha256 \
  && rm /tmp/tokenizer.sha256

FROM node:24.18.1-bookworm-slim AS runtime-base

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

FROM runtime-base AS worker

LABEL org.opencontainers.image.description="ingestion-control Temporal worker"

USER root

RUN install -d -m 0755 /opt/campus-agent/models/qwen3-embedding-4b

COPY --from=rust-kernel-build /rust-workspace/target/release/ingestion-kernel-runner /usr/local/bin/ingestion-kernel-runner
COPY --from=tokenizer-download --chmod=0444 /model/tokenizer.json /opt/campus-agent/models/qwen3-embedding-4b/tokenizer.json

USER node

CMD ["/app/apps/ingestion-control/node_modules/.bin/tsx", "/app/apps/ingestion-control/src/temporal-worker.ts"]

FROM runtime-base AS api

LABEL org.opencontainers.image.description="ingestion-control HTTP API"

EXPOSE 8000

CMD ["/app/apps/ingestion-control/node_modules/.bin/tsx", "/app/apps/ingestion-control/src/server.ts"]

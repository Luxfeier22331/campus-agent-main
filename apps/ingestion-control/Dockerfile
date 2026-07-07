FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/ingestion-control/package.json ./apps/ingestion-control/package.json
COPY packages/ingest-core/package.json ./packages/ingest-core/package.json
COPY packages/ingestion-contracts/package.json ./packages/ingestion-contracts/package.json

RUN corepack enable pnpm \
  && pnpm install --frozen-lockfile --filter ingestion-control...

COPY apps/ingestion-control ./apps/ingestion-control
COPY configs/ingestion ./configs/ingestion
COPY packages/ingest-core ./packages/ingest-core
COPY packages/ingestion-contracts ./packages/ingestion-contracts

RUN pnpm --filter ingestion-control typecheck

FROM rust:1.91-bookworm AS rust-kernel-build

WORKDIR /rust-workspace

COPY Cargo.toml Cargo.lock ./
COPY packages/ingestion-kernels-rs ./packages/ingestion-kernels-rs

RUN cargo build --locked -p ingestion-kernels-rs --bin ingestion-kernel-runner --release

FROM node:24-bookworm-slim AS runtime

WORKDIR /app
LABEL org.opencontainers.image.description="ingestion-control image supports api command and temporal-worker command"
ENV NODE_ENV=production
ENV INGESTION_CONTROL_HOST=0.0.0.0
ENV INGESTION_CONTROL_PORT=8000
ENV INGESTION_TASK_REGISTRY_ROOT=/app/configs/ingestion

COPY --from=build /app /app
COPY --from=rust-kernel-build /rust-workspace/target/release/ingestion-kernel-runner /usr/local/bin/ingestion-kernel-runner

USER node

EXPOSE 8000

# temporal-worker command: node --experimental-strip-types apps/ingestion-control/src/temporal-worker.ts
CMD ["node", "--experimental-strip-types", "apps/ingestion-control/src/server.ts"]

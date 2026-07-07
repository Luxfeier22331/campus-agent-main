FROM mcr.microsoft.com/playwright:v1.61.1-noble

WORKDIR /workspace

RUN corepack enable pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/source-collector/package.json apps/source-collector/package.json
COPY packages/ingest-core/package.json packages/ingest-core/package.json
COPY packages/ingestion-contracts/package.json packages/ingestion-contracts/package.json

RUN pnpm install --frozen-lockfile --filter source-collector...

COPY apps/source-collector apps/source-collector
COPY packages/ingest-core packages/ingest-core
COPY packages/ingestion-contracts packages/ingestion-contracts

RUN pnpm --filter source-collector typecheck

WORKDIR /workspace/apps/source-collector

ENTRYPOINT ["pnpm", "--dir", "/workspace/apps/source-collector", "exec", "tsx"]
CMD ["--version"]

FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/ingestion-control/package.json ./apps/ingestion-control/package.json
COPY packages/ingestion-contracts/package.json ./packages/ingestion-contracts/package.json

RUN corepack enable pnpm \
  && pnpm install --frozen-lockfile --filter ingestion-control...

COPY apps/ingestion-control ./apps/ingestion-control
COPY configs/ingestion ./configs/ingestion
COPY packages/ingestion-contracts ./packages/ingestion-contracts

RUN pnpm --filter ingestion-control typecheck

FROM node:24-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV INGESTION_CONTROL_HOST=0.0.0.0
ENV INGESTION_CONTROL_PORT=8000
ENV INGESTION_TASK_REGISTRY_ROOT=/app/configs/ingestion

COPY --from=build /app /app

USER node

EXPOSE 8000

CMD ["node", "--experimental-strip-types", "apps/ingestion-control/src/server.ts"]

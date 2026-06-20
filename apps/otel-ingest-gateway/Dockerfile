FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/otel-ingest-gateway/package.json ./apps/otel-ingest-gateway/package.json

RUN corepack enable pnpm \
  && pnpm install --frozen-lockfile --filter otel-ingest-gateway...

COPY apps/otel-ingest-gateway ./apps/otel-ingest-gateway

RUN pnpm --filter otel-ingest-gateway typecheck

FROM node:24-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV OTEL_INGEST_HOST=0.0.0.0
ENV OTEL_INGEST_PORT=8000

COPY --from=build /app /app

USER node

EXPOSE 8000

CMD ["node", "--experimental-strip-types", "apps/otel-ingest-gateway/src/server.ts"]

FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY jobs/transport-publisher/package.json ./jobs/transport-publisher/package.json

RUN corepack enable pnpm \
  && pnpm install --frozen-lockfile --filter transport-publisher...

COPY jobs/transport-publisher ./jobs/transport-publisher
COPY apps/app-api/db/shared-product-schema/campus_services.sql ./apps/app-api/db/shared-product-schema/campus_services.sql
COPY packages/contracts/schemas/transport-schedule-status.v1.schema.json ./packages/contracts/schemas/transport-schedule-status.v1.schema.json

RUN pnpm --filter transport-publisher typecheck

FROM node:24-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app /app

USER node

ENTRYPOINT ["/app/jobs/transport-publisher/node_modules/.bin/tsx", "/app/jobs/transport-publisher/src/cli.ts"]

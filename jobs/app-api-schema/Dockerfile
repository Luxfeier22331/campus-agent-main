FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY jobs/app-api-schema/package.json ./jobs/app-api-schema/package.json

RUN npm install --global corepack@0.35.0 \
  && npm cache clean --force \
  && corepack enable pnpm \
  && pnpm install --frozen-lockfile --prod --filter app-api-schema...

COPY apps/app-api/db/shared-product-schema ./apps/app-api/db/shared-product-schema
COPY apps/app-api/drizzle ./apps/app-api/drizzle
COPY apps/app-api/ops/db ./apps/app-api/ops/db
COPY apps/app-api/package.json ./apps/app-api/package.json
COPY apps/app-api/src/script-support/shared-db ./apps/app-api/src/script-support/shared-db

RUN ln -s ../../jobs/app-api-schema/node_modules apps/app-api/node_modules \
  && node -e "import('./apps/app-api/ops/db/schema.ts')"

USER node

ENTRYPOINT ["node", "apps/app-api/ops/db/schema.ts"]

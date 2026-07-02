FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY jobs/dining-sync/package.json ./jobs/dining-sync/package.json
COPY packages/dining-domain/package.json ./packages/dining-domain/package.json
COPY packages/dining-floorplans/package.json ./packages/dining-floorplans/package.json

RUN corepack enable pnpm \
  && pnpm install --frozen-lockfile --filter dining-sync...

COPY jobs/dining-sync ./jobs/dining-sync
COPY packages/dining-domain ./packages/dining-domain
COPY packages/dining-floorplans ./packages/dining-floorplans

RUN pnpm --filter dining-sync typecheck

FROM node:24-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app /app

USER node

CMD ["pnpm", "--dir", "jobs/dining-sync", "exec", "tsx", "src/cli.ts", "sync-all"]

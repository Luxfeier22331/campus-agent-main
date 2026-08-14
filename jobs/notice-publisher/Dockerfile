FROM node:24.18.1-bookworm-slim AS pruner
ENV PNPM_HOME=/pnpm PATH=$PNPM_HOME:$PATH CI=true
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
RUN corepack enable pnpm && pnpm install --frozen-lockfile --filter campus-agent-web-workspace
COPY . .
RUN pnpm exec turbo prune notice-publisher --docker --out-dir=/repo/out

FROM node:24.18.1-bookworm-slim
ENV PNPM_HOME=/pnpm PATH=$PNPM_HOME:$PATH CI=true NODE_ENV=production
WORKDIR /app
COPY --from=pruner /repo/out/json/ ./
RUN corepack enable pnpm && pnpm install --frozen-lockfile --filter notice-publisher...
COPY --from=pruner /repo/out/full/ ./
RUN pnpm --filter notice-publisher typecheck
USER node
ENTRYPOINT ["/app/jobs/notice-publisher/node_modules/.bin/tsx", "/app/jobs/notice-publisher/src/cli.ts"]

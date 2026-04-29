FROM mcr.microsoft.com/playwright:v1.59.1-noble

WORKDIR /workspace

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/authenticated-notice-collector/package.json apps/authenticated-notice-collector/package.json
RUN pnpm install --filter authenticated-notice-collector --frozen-lockfile

COPY apps/authenticated-notice-collector apps/authenticated-notice-collector
RUN pnpm --dir apps/authenticated-notice-collector build

ENV AUTHENTICATED_NOTICE_RUNTIME_DIR=/workspace/apps/authenticated-notice-collector/runtime

ENTRYPOINT ["node", "apps/authenticated-notice-collector/dist/collector-entrypoint.js"]

FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/agent-runtime/package.json ./apps/agent-runtime/package.json

RUN corepack enable pnpm \
  && pnpm install --frozen-lockfile --filter agent-runtime

COPY apps/agent-runtime ./apps/agent-runtime
COPY configs/runtime/tool-catalog.v1.json ./configs/runtime/tool-catalog.v1.json
COPY configs/runtime/tool-function-schemas.v1.json ./configs/runtime/tool-function-schemas.v1.json

RUN pnpm --filter agent-runtime typecheck

FROM node:24-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production \
  AGENT_RUNTIME_HOST=0.0.0.0 \
  AGENT_RUNTIME_PORT=27062 \
  AGENT_RUNTIME_TOOL_CATALOG_PATH=configs/runtime/tool-catalog.v1.json

COPY --from=build /app /app

USER node

EXPOSE 27062

CMD ["node", "--experimental-strip-types", "apps/agent-runtime/src/server.ts"]

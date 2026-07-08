FROM node:24.15-bookworm-slim AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/agent-runtime/package.json ./apps/agent-runtime/package.json

RUN npm install --global corepack@0.35.0 \
  && npm cache clean --force \
  && corepack enable pnpm \
  && pnpm install --frozen-lockfile --filter agent-runtime

COPY apps/agent-runtime ./apps/agent-runtime
COPY configs/runtime/tools.v4.json ./configs/runtime/tools.v4.json
COPY configs/runtime/tool-function-schemas.v1.json ./configs/runtime/tool-function-schemas.v1.json

RUN pnpm --filter agent-runtime typecheck

FROM node:24.15-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production \
  AGENT_RUNTIME_HOST=0.0.0.0 \
  AGENT_RUNTIME_PORT=27062 \
  AGENT_RUNTIME_TOOL_REGISTRY_PATH=configs/runtime/tools.v4.json

RUN apt-get update \
  && apt-get upgrade -y \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/corepack /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/pnpm /usr/local/bin/pnpx

COPY --from=build /app /app

USER node

EXPOSE 27062

CMD ["node", "--experimental-strip-types", "apps/agent-runtime/src/server.ts"]

FROM ghcr.io/astral-sh/uv:0.8.22-python3.12-bookworm-slim AS build

WORKDIR /app
ENV UV_LINK_MODE=copy

COPY apps/supervisor-agent-worker ./apps/supervisor-agent-worker
COPY configs/ingestion ./configs/ingestion
COPY configs/runtime ./configs/runtime
COPY packages/campus-services-agent ./packages/campus-services-agent
COPY packages/contracts ./packages/contracts
COPY packages/ingestion-core ./packages/ingestion-core
COPY packages/navigation-agent ./packages/navigation-agent
COPY packages/notice-agent ./packages/notice-agent
COPY packages/rag-agent ./packages/rag-agent
COPY packages/retrieval-core ./packages/retrieval-core
COPY packages/shared ./packages/shared

RUN <<'EOF'
cat > /app/pyproject.toml <<'PYPROJECT'
[project]
name = "campus-supervisor-runtime"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = []

[tool.uv]
package = false

[tool.uv.workspace]
members = [
  "apps/supervisor-agent-worker",
  "packages/campus-services-agent",
  "packages/contracts",
  "packages/ingestion-core",
  "packages/navigation-agent",
  "packages/notice-agent",
  "packages/rag-agent",
  "packages/retrieval-core",
  "packages/shared",
]
PYPROJECT

uv sync --project /app --all-packages --no-dev
EOF

FROM python:3.12-slim-bookworm AS runtime

WORKDIR /app
ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONPATH="/app/apps/supervisor-agent-worker/src:/app/packages/campus-services-agent/src:/app/packages/contracts/src:/app/packages/ingestion-core/src:/app/packages/navigation-agent/src:/app/packages/notice-agent/src:/app/packages/rag-agent/src:/app/packages/retrieval-core/src:/app/packages/shared/src"
ENV SUPERVISOR_AGENT_WORKER_HOST=0.0.0.0
ENV SUPERVISOR_AGENT_WORKER_PORT=27052
ENV SUPERVISOR_AGENT_WORKER_REQUEST_BODY_LIMIT_BYTES=1048576

COPY --from=build /app /app

EXPOSE 27052

ENTRYPOINT ["campus-supervisor-agent-worker-dev"]

FROM ghcr.io/astral-sh/uv:0.8.22-python3.12-bookworm-slim AS build

WORKDIR /app
ENV UV_LINK_MODE=copy

COPY apps/ingestion-worker ./apps/ingestion-worker
COPY packages/ingestion-core ./packages/ingestion-core
COPY packages/shared ./packages/shared

RUN <<'EOF'
cat > /app/pyproject.toml <<'PYPROJECT'
[project]
name = "campus-ingestion-runtime"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = []

[tool.uv]
package = false

[tool.uv.workspace]
members = [
  "apps/ingestion-worker",
  "packages/ingestion-core",
  "packages/shared",
]
PYPROJECT

uv sync --project /app --all-packages --no-dev
EOF

FROM ghcr.io/astral-sh/uv:0.8.22-python3.12-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends time \
  && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin appuser

WORKDIR /app
ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONPATH="/app/apps/ingestion-worker/src:/app/packages/ingestion-core/src:/app/packages/shared/src"

COPY --from=build --chown=appuser:appuser /app /app

RUN chmod +x /app/apps/ingestion-worker/docker-entrypoint.sh

RUN mkdir -p /var/lib/campus-agent/ingestion-adapters \
  && chown -R appuser:appuser /var/lib/campus-agent

USER appuser

ENTRYPOINT ["/app/apps/ingestion-worker/docker-entrypoint.sh"]

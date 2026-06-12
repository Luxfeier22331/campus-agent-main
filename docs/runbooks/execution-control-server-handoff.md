---
doc_type: runbook
status: active
created: 2026-04-27
updated: 2026-06-09
---
# Execution Control Server Handoff

## 文档边界

这份 runbook 只定义 Docker-first `execution-control` server handoff baseline：

- `execution-control + Temporal + split workers` compose deployment contract
- server env / health / logging / restart / resource 基线
- `app-api` execution origin 对接约束

它不覆盖：

- WSL + Windows scheduled task staging host 细节
- browser smoke 与产品验收
- runtime language split 或服务重构

## Target Shape

- compose file: `infra/local/docker-compose.execution-control-runtime.yml`
- services:
  - `execution-control`
  - `workflow-worker`
  - `activity-worker-context`
  - `activity-worker-knowledge`
  - `activity-worker-campus-services`
  - `activity-worker-notice`
  - `activity-worker-navigation`
  - `activity-worker-finalization`
  - `worker-autoscaler`
  - `temporal`
- ingress:
  - machine-local reverse proxy 指向 `execution-control:8000`
- upstream contract:
  - `app-api` 调用 `STAGING_EXECUTION_CONTROL_BASE_URL`（或对应环境等价键）
  - worker origin auth 由 `API_WORKER_SHARED_SECRET` 控制

## Server Env Baseline

建议通过 server-local env file（例如 `/etc/campus-agent/supervisor-runtime.env`）注入：

- required:
  - `API_WORKER_SHARED_SECRET`
  - `EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET`
  - `EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL`
  - `EXECUTION_CONTROL_TEMPORAL_ADDRESS`
  - `EXECUTION_CONTROL_TEMPORAL_NAMESPACE`
  - `QDRANT_URL`
  - `QDRANT_QUERY_API_KEY`
  - `QDRANT_TLS_CA_CERT_PATH`
  - `EMBEDDING_*`
  - `PROMPT_RUNTIME_*`
  - `EXECUTION_PROMPT_MODEL` / `AGENT_PROMPT_MODEL`（或 `PROMPT_RUNTIME_MODEL`）
- conditional:
  - Qdrant service lifecycle、backup / restore 或 ingestion rebuild 管理路径才使用 admin
    `QDRANT_API_KEY`
  - 启用 execution audit 时：`EXECUTION_CONTROL_EXECUTION_AUDIT_URL`、
    `EXECUTION_CONTROL_EXECUTION_AUDIT_SHARED_SECRET`
  - 打开 `campus_services` / `notice` capability 时：`CAMPUS_SHARED_POSTGRES_URL`；
    notice 还需要 object-store/read-model 依赖

禁止把 deploy-only secret 写回 repo-tracked `.env.example`。

## Deployment Steps

1. build image

```bash
docker build \
  -f apps/execution-control/Dockerfile \
  -t campus-execution-control:local .
```

1. start runtime

```bash
COMPOSE_PROJECT_NAME=campus-execution-control-runtime \
EXECUTION_CONTROL_HOST_PORT=27051 \
docker compose \
  -f infra/local/docker-compose.execution-control-runtime.yml \
  up -d --build
```

1. health/readiness checks

```bash
curl -sS -i http://127.0.0.1:27051/healthz
curl -sS -i http://127.0.0.1:27051/readyz
curl -sS -i http://127.0.0.1:27051/metrics
```

1. smoke

```bash
infra/local/smoke-execution-control-runtime.sh closed_gate
```

## Runtime Baseline

- compose-level:
  - `restart: unless-stopped`
  - healthcheck on both containers
  - `no-new-privileges`
  - JSON log rotation (`10m * 3`)
- process-level:
  - `EXECUTION_CONTROL_MAX_CONCURRENT_ANSWERS`
  - `EXECUTION_CONTROL_QUEUE_CAPACITY`
  - `EXECUTION_CONTROL_QUEUE_TIMEOUT_MS`
  - lane budgets (`EXECUTION_CONTROL_LANE_*`)
- ingress-level:
  - metrics token (`EXECUTION_CONTROL_METRICS_BEARER_TOKEN`) when metrics endpoint
    is externally reachable

## Handoff Checklist

- doctor:
  - `uv run --all-packages python -m scripts.doctor_env execution-control --json`
- static checks:
  - `pnpm go:check`
  - `pnpm shell:lint`
  - `pnpm yaml:lint`
- runtime checks:
  - Docker build success
  - `healthz` / `readyz` / `metrics` return expected status
  - smoke artifact generated under `.tmp/execution-control-local-smoke/`
- app-api integration:
  - execution origin URL configured to current server ingress
  - shared secret aligned with `API_WORKER_SHARED_SECRET`

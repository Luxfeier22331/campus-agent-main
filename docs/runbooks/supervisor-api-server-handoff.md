---
doc_type: runbook
status: active
created: 2026-04-27
updated: 2026-04-27
---
# Execution Gateway Server Handoff

## 文档边界

这份 runbook 只定义 Docker-first `execution-gateway` server handoff baseline：

- `execution-gateway + supervisor-agent-worker` 双容器部署契约
- server env / health / logging / restart / resource 基线
- `app-api` execution origin 对接约束

它不覆盖：

- WSL + Windows scheduled task staging host 细节
- browser smoke 与产品验收
- runtime language split 或服务重构

## Target Shape

- compose file: `infra/local/docker-compose.supervisor-runtime.yml`
- services:
  - `execution-gateway`
  - `supervisor-agent-worker`
- ingress:
  - machine-local reverse proxy 或 tunnel 指向 `execution-gateway:8000`
- upstream contract:
  - `app-api` 调用 `STAGING_EXECUTION_GATEWAY_BASE_URL`（或对应环境等价键）
  - worker origin auth 由 `API_WORKER_SHARED_SECRET` 控制

## Server Env Baseline

建议通过 server-local env file（例如 `/etc/campus-agent/supervisor-runtime.env`）注入：

- required:
  - `API_WORKER_SHARED_SECRET`
  - `SUPERVISOR_AGENT_WORKER_SHARED_SECRET`
  - `SUPERVISOR_AGENT_WORKER_BASE_URL`（compose 内可固定为 service DNS）
  - `SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET`
  - `SUPERVISOR_PROMPT_MODEL` / `AGENT_PROMPT_MODEL`（或 `PROMPT_RUNTIME_MODEL`）
- conditional:
  - 启用 execution audit 时：`EXECUTION_GATEWAY_EXECUTION_AUDIT_URL`、
    `EXECUTION_GATEWAY_EXECUTION_AUDIT_SHARED_SECRET`
  - 打开 `campus_services` / `notice` capability 时：`CAMPUS_SHARED_POSTGRES_URL`；
    notice 还需要 object-store/read-model 依赖

禁止把 deploy-only secret 写回 repo-tracked `.env.example`。

## Deployment Steps

1. build image

```bash
docker build \
  -f apps/execution-gateway/Dockerfile \
  -t campus-execution-gateway:local .
```

1. start runtime

```bash
COMPOSE_PROJECT_NAME=campus-supervisor-runtime \
EXECUTION_GATEWAY_HOST_PORT=27051 \
docker compose -f infra/local/docker-compose.supervisor-runtime.yml up -d --build
```

1. health/readiness checks

```bash
curl -sS -i http://127.0.0.1:27051/healthz
curl -sS -i http://127.0.0.1:27051/readyz
curl -sS -i http://127.0.0.1:27051/metrics
```

1. smoke

```bash
infra/local/smoke-supervisor-runtime.sh closed_gate
```

## Runtime Baseline

- compose-level:
  - `restart: unless-stopped`
  - healthcheck on both containers
  - `no-new-privileges`
  - JSON log rotation (`10m * 3`)
- process-level:
  - `EXECUTION_GATEWAY_MAX_CONCURRENT_ANSWERS`
  - `EXECUTION_GATEWAY_QUEUE_CAPACITY`
  - `EXECUTION_GATEWAY_QUEUE_TIMEOUT_MS`
  - lane budgets (`EXECUTION_GATEWAY_LANE_*`)
- ingress-level:
  - metrics token (`EXECUTION_GATEWAY_METRICS_BEARER_TOKEN`) when metrics endpoint
    is externally reachable

## Handoff Checklist

- doctor:
  - `uv run --all-packages python -m scripts.doctor_env execution-gateway --json`
- static checks:
  - `pnpm go:check`
  - `pnpm shell:lint`
  - `pnpm yaml:lint`
- runtime checks:
  - Docker build success
  - `healthz` / `readyz` / `metrics` return expected status
  - smoke artifact generated under `.tmp/execution-gateway-local-smoke/`
- app-api integration:
  - execution origin URL configured to current server ingress
  - shared secret aligned with `API_WORKER_SHARED_SECRET`

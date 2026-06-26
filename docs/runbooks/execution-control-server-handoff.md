---
doc_type: runbook
truth_scope: ops
owner_boundary: docs/runbooks
status: active
created: 2026-04-27
updated: 2026-06-09
---
# Execution Control Server Handoff

## 文档边界

这份 runbook 只定义 Compose-based `execution-control` server handoff baseline：

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
  - `agent-runtime`
  - `workflow-worker`
  - `activity-worker-context`
  - `activity-worker-agent`
  - `activity-worker-knowledge-plan`
  - `activity-worker-knowledge-retrieval`
  - `activity-worker-knowledge-synthesis`
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

建议通过 server-local env file（例如 `/etc/campus-agent/execution-runtime.env`）注入：

- required:
  - `API_WORKER_SHARED_SECRET`
  - `EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET`
  - `EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL`
  - `EXECUTION_CONTROL_TEMPORAL_ADDRESS`
  - `EXECUTION_CONTROL_TEMPORAL_NAMESPACE`
  - `QDRANT_URL`
  - `QDRANT_QUERY_API_KEY`
  - `QDRANT_TLS_CA_CERT_PATH`
  - `EXECUTION_CONTROL_PROVIDER_CONFIG_SNAPSHOT_PATH`
- conditional:
  - online prompt / embedding provider model/API key truth must already exist in
    the local `provider_config_projection.v1` artifact; do not hardcode them in
    execution-control env. Required prompt roles are `primary_agent`,
    `rag_synthesis` and `hindsight_llm`; required online embedding roles are
    `rag_query_embedding` and `hindsight_embedding`.
  - personal memory runtime uses internal Hindsight service discovery by
    default. Lifecycle scripts project `PERSONAL_MEMORY_BASE_URL` to
    `http://hindsight-api:8888` and generate persistent
    `PERSONAL_MEMORY_API_SECRET` / `PERSONAL_MEMORY_OWNER_SALT` values in an
    ops-owned generated env file.
  - local self-host runtime bundle secrets are generated into
    `infra/local/.generated/runtime.env` by
    `infra/local/start-execution-control-runtime.sh`; server/staging deploys
    must use their own ops-owned generated env file instead of copying that
    local file.
  - Hindsight LLM / embedding provider env is projected from the same local
    provider projection artifact. Do not copy local provider env to staging, do
    not proxy Hindsight model traffic through app-api, and do not reintroduce
    retired `memory_graph_llm` or `personal_memory_extraction` provider roles.
  - Qdrant service lifecycle、backup / restore 或 ingestion rebuild 管理路径才使用 admin
    `QDRANT_API_KEY`
  - 启用 execution audit 时：`EXECUTION_CONTROL_EXECUTION_AUDIT_URL`、
    `EXECUTION_CONTROL_EXECUTION_AUDIT_SHARED_SECRET`
  - 打开 `campus_services` / `notice` capability 时：`CAMPUS_SHARED_POSTGRES_URL`；
    notice 还需要 object-store/read-model 依赖

禁止把 deploy-only secret 写回 repo-tracked `.env.example`。

Deployment/start 脚本必须投影同机 internal agent-runtime link env：

- `EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL`：execution-control 调用
  `agent-runtime` `/internal/agent-runs` 的地址；compose / staging baseline 使用
  `http://agent-runtime:27062`。
- `EXECUTION_CONTROL_AGENT_RUNTIME_SHARED_SECRET` 与 `AGENT_RUNTIME_SHARED_SECRET`：
  两个进程之间的 shared secret，必须一致；canonical staging loader 未收到显式值时会从
  `EXECUTION_CONTROL_SHARED_SECRET` 和 `EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET`
  派生并同时注入。
- `AGENT_RUNTIME_EXECUTION_CONTROL_BASE_URL`：primary agent runtime 调用
  execution-control internal query typed tools 的地址；compose / staging baseline 使用
  `http://execution-control:8000`。
- `AGENT_RUNTIME_EXECUTION_CONTROL_SHARED_SECRET`：默认等于
  `EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET`，否则 typed tool executor fail closed。
- `EXECUTION_CONTROL_PROVIDER_CONFIG_SNAPSHOT_PATH`：execution-control 本地读取
  `provider_config_projection.v1` artifact 的路径；compose / staging baseline 使用
  `/run/campus-agent/provider-config-projection.json`。
- `EXECUTION_CONTROL_APP_API_INTERNAL_BASE_URL` /
  `EXECUTION_CONTROL_APP_API_INTERNAL_SHARED_SECRET`：只服务 provider projection sync
  与 provider activation compatibility control-plane calls；execution-control 不在
  provider runtime 热路径读取 app-api active snapshot。
- embedding profile activation 时 app-api 会反向调用 execution-control
  `/internal/provider-config/embedding:check-compatibility` 做 release/vector
  compatibility check。这个请求只携带 provider/model/dimensions 等候选元数据，不携带
  raw API key；raw provider key 只存在于 app-api encrypted provider-config profile。

这些是部署投影责任，不是用户在尚未部署前需要手工配置的外部输入。非 compose / 非 canonical
topology 才应在 server-local env file 或等价 deployment secret source 覆写地址。

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

Personal memory runtime smoke 后，`/metrics` 至少应能观察到 bounded-label memory
operation 指标族，不得出现 user / tenant / run / conversation id label：

```text
campus_execution_control_personal_memory_operations_total
campus_execution_control_personal_memory_operation_duration_ms
campus_execution_control_personal_memory_selected_items_count
campus_execution_control_personal_memory_selected_chars_count
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
  - `EXECUTION_CONTROL_RUNTIME_CONFIG_PATH`
  - runtime profile admission budget
  - runtime profile lane budgets
- ingress-level:
  - metrics token (`EXECUTION_CONTROL_METRICS_BEARER_TOKEN`) when metrics endpoint
    is externally reachable

## Handoff Checklist

- doctor:
  - `uv run --all-packages python -m scripts.doctor_env execution-control --json`
- static checks:
  - `pnpm go:check`
  - `pnpm repo:static`
- runtime checks:
  - Docker build success
  - `healthz` / `readyz` / `metrics` return expected status
  - smoke artifact generated under `.tmp/execution-control-local-smoke/`
- app-api integration:
  - execution origin URL configured to current server ingress
  - shared secret aligned with `API_WORKER_SHARED_SECRET`

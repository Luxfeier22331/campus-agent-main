---
doc_type: runbook
status: active
created: 2026-04-24
updated: 2026-05-08
---
# Supervisor API Staging Operations

## 文档边界

这份 runbook 只回答当前 canonical staging execution upstream 的长期运维真相：

- 当前 repo-owned staging execution runtime 是 `otel-collector + supervisor-api + supervisor-agent-worker`
  三容器
- `exec-staging.ayafeed.com` 继续通过 named tunnel 指回这台主机上的本地
  `supervisor-api` runtime

它不覆盖 browser smoke 证据采集；那部分统一看
`supervisor-api-staging-smoke-runbook.md`。
它也不作为通用 Linux server 部署文档；server handoff 见
`supervisor-api-server-handoff.md`。

## 当前真相

- `apps/supervisor-api` 的前向 deploy substrate 已冻结为 Docker-first internal execution
  service
- 当前 repo-owned staging execution runtime：
  - `infra/local/docker-compose.supervisor-runtime.yml`
  - `otel-collector`
    - repo-owned runtime telemetry fan-out
    - local OTLP ingress `4317/4318`
    - health check `13133`
  - `supervisor-api`
    - `trusted-worker`
    - `127.0.0.1:27010`
    - `/healthz` `/readyz` `/metrics` `/api/v1/answer`
    - bounded in-process admission queue / backpressure / graceful drain
  - `supervisor-agent-worker`
    - private `/internal/bridge/*`
- named tunnel：
  - tunnel name: `supervisor-api-staging`
  - public hostname: `<https://exec-staging.ayafeed.com`>
  - connector config 必须把该 hostname 指到本机 `http://127.0.0.1:27010`
- shared staging `app-api`：
  - `<https://campus-api-staging.ayafeed.com`>
- 常驻机制：
  - Windows scheduled task: `CampusAgent-SupervisorApiStaging`
  - WSL-side lifecycle scripts: `infra/local/staging/start-supervisor-api-staging.sh`
  - strict health check: `infra/local/staging/status-supervisor-api-staging.sh --check`
  - lifecycle lock: `.tmp/supervisor-api-staging/lifecycle.lock`

以上是当前 staging host（WSL + Windows scheduler）特定形态，不代表通用 server runtime
管理方式。

## 安装与重装

首次安装或重装计划任务：

```bash
infra/local/staging/install-supervisor-api-staging-task.sh
```

安装后核对：

```bash
powershell.exe -NoProfile -Command \
  "Get-ScheduledTask -TaskName 'CampusAgent-SupervisorApiStaging' | \
  Format-List TaskName,Description,Triggers,Actions"
```

应看到：

- 任务名为 `CampusAgent-SupervisorApiStaging`
- action 通过 `wsl.exe ... bash -lc` 进入当前 repo
- action 会显式注入：
  - `SUPERVISOR_API_STAGING_PORT=27010`
  - `SUPERVISOR_API_STAGING_TUNNEL_NAME=supervisor-api-staging`
  - `SUPERVISOR_API_STAGING_PUBLIC_BASE_URL=<https://exec-staging.ayafeed.com`>
  - `SUPERVISOR_API_STAGING_APP_API_BASE_URL=<https://campus-api-staging.ayafeed.com`>
- trigger 包含：
  - 登录时执行一次
  - 每 5 分钟重复执行一次

## 日常健康检查

人类可读状态：

```bash
infra/local/staging/status-supervisor-api-staging.sh
```

严格健康检查：

```bash
infra/local/staging/status-supervisor-api-staging.sh --check
```

`--check` 通过标准：

- `otel-collector`、`supervisor-api` 与
  `supervisor-agent-worker` 都在当前 compose project 中运行
- 如果配置了 public execution origin，则 `cloudflared` 进程存在
- 本地 `<http://127.0.0.1:27010/healthz`> 返回 `200`
- 本地 `<http://127.0.0.1:27010/readyz`> 带 `x-worker-origin-auth` 返回 `200`
- 本地 `<http://127.0.0.1:27010/metrics`> 带 bearer token 返回 `200`
- `<https://campus-api-staging.ayafeed.com/readyz`> 返回 `200`
- `campus-api-staging` 的 `auth`、`database`、`supervisorApi` 都是 `ready`

补充约束：

- `supervisor-api` 默认 admission 参数为 `SUPERVISOR_API_MAX_CONCURRENT_ANSWERS=8`、
  `SUPERVISOR_API_QUEUE_CAPACITY=24`、`SUPERVISOR_API_QUEUE_TIMEOUT_MS=3000`、
  `SUPERVISOR_API_REQUEST_TIMEOUT_MS=45000` 与
  `SUPERVISOR_AGENT_WORKER_TIMEOUT_MS=35000`
- 默认 bridge protection 参数为 `SUPERVISOR_API_BRIDGE_BREAKER_FAILURE_THRESHOLD=5`、
  `SUPERVISOR_API_BRIDGE_BREAKER_OPEN_MS=10000`、
  `SUPERVISOR_API_BRIDGE_RETRY_MAX_ATTEMPTS=2` 与
  `SUPERVISOR_API_BRIDGE_RETRY_BASE_MS=50`
- 默认 lane budget 为 `rag=6/12/3000ms`、`navigation=2/4/1500ms`、
  `campus_services=2/4/1500ms`、`notice=2/4/1500ms`、`default=1/2/1500ms`；
  三元组含义为 `max_concurrent / queue_capacity / queue_timeout`
- staging 默认启用 `SUPERVISOR_API_OTEL_ENABLED=true`、
  `SUPERVISOR_API_OTEL_METRICS_ENABLED=true` 与
  `SUPERVISOR_AGENT_WORKER_OTEL_ENABLED=true`
- `supervisor-api` traces / metrics 都应发往本地 `otel-collector`
- `supervisor-agent-worker` runtime events 可以同时保留 JSONL debug sink，并直接发往
  本地 `otel-collector` 的 OTLP HTTP traces / metrics / logs endpoints
- OTel attribute allowlist、forbidden fields 与 sink ownership 以
  `docs/reference/runtime-otel-telemetry-taxonomy.md` 为准；staging 不应把 raw prompt、
  raw query、raw answer、token、cookie、auth material 或正文片段发往 Sentry/Axiom
- Collector / Sentry / Axiom fan-out 操作以
  `docs/runbooks/runtime-otel-collector-pipeline.md` 为准；runtime 只把 sanitized OTLP
  发给 Collector，vendor endpoint/header/dataset 由部署 secret 注入
- `supervisor-api` 会从入口请求提取 `traceparent` / `baggage`；为兼容当前
  `app-api` 链路，也会把有效的 `sentry-trace` 转成标准 `traceparent`。向
  `supervisor-agent-worker` 只传播 `traceparent`、`baggage`、`x-request-id`
  与 `x-trace-id`
- staging profile 必须设置 `SUPERVISOR_API_METRICS_BEARER_TOKEN`；
  `status-supervisor-api-staging.sh` 会用该 token 拉取本地 `/metrics`，且不应把
  raw token 写入日志
- staging profile 下，supervisor-api full `/readyz` 是内部 runtime probe；
  local lifecycle script 使用 `API_WORKER_SHARED_SECRET` 对本地 `/readyz` 加
  `x-worker-origin-auth`。public deploy / smoke closure 不直接要求
  `exec-staging.ayafeed.com/readyz`，而是通过 `campus-api-staging /readyz`
  证明 app-api 已用内部 shared secret 完成 supervisor readiness probe
- `/readyz` 不因瞬时 `active_answers == max_concurrent_answers` 直接 degraded；只有
  admission queue 已不可接收、runtime draining 或 bridge 不健康时才视为 execution
  runtime 不 ready
- `supervisor-agent-worker` 必须同时拿到 query runtime env，包括 `QDRANT_URL`、
  `QDRANT_API_KEY`、`QDRANT_TIMEOUT_SECONDS`、`DOCUMENT_REGISTRY_DATABASE_URL` 或
  `CAMPUS_SHARED_POSTGRES_URL`、`EMBEDDING_*` 与 `SPARSE_*`
- `infra/local/staging/start-supervisor-api-staging.sh` 会从 repo env 与 `apps/app-api/.dev.vars`
  导入这些变量，再通过 `infra/local/docker-compose.supervisor-runtime.yml` 注入容器
- 如果 registry Postgres URL 指向 `127.0.0.1` 或 `localhost`，启动脚本会为 Docker
  orchestrator 改写成 `host.docker.internal`；compose 通过 `host-gateway` 解析回宿主机
- 当 compose project 尚未运行、启动脚本需要 `docker compose up -d --build` 时，
  `start-supervisor-api-staging.sh` 会先执行
  `infra/local/staging/preflight-supervisor-api-staging.sh`
- preflight 会通过 `docker version --format '{{.Server.Version}}'` 检查 Docker daemon，
  并检查 Docker Compose v2、compose 文件存在性，以及当前 staging Dockerfile 依赖的 base image
  registry 可达性：
  - `golang:1.26.2-bookworm`
  - `debian:bookworm-slim`
  - `python:3.12-slim-bookworm`
  - `ghcr.io/astral-sh/uv:0.8.22-python3.12-bookworm-slim`
- registry preflight 默认使用 `docker buildx imagetools inspect`；设置
  `SUPERVISOR_API_STAGING_PREFLIGHT_PULL=1` 时改用 `docker pull`
- Docker daemon / Compose 基础检查默认 `10s` 超时，可用
  `SUPERVISOR_API_STAGING_PREFLIGHT_DOCKER_TIMEOUT_SECONDS` 调整；registry 检查默认
  `30s` 超时，可用 `SUPERVISOR_API_STAGING_PREFLIGHT_REGISTRY_TIMEOUT_SECONDS` 调整
- 如果 staging host 已经预拉取 base image 且处于受控离线/代理故障窗口，可设置
  `SUPERVISOR_API_STAGING_PREFLIGHT_SKIP_REGISTRY=1` 跳过 registry 检查；这只应作为本机
  环境绕过，不表示 registry 依赖已恢复

计划任务层状态：

```bash
powershell.exe -NoProfile -Command \
  "Get-ScheduledTaskInfo -TaskName 'CampusAgent-SupervisorApiStaging' | \
  Format-List LastRunTime,LastTaskResult,NextRunTime,NumberOfMissedRuns"
```

## 冷启动恢复

当前 canonical 冷启动恢复流程：

```bash
infra/local/staging/stop-supervisor-api-staging.sh
powershell.exe -NoProfile -Command \
  "Start-ScheduledTask -TaskName 'CampusAgent-SupervisorApiStaging'"
until infra/local/staging/status-supervisor-api-staging.sh --check; do \
  sleep 2; done
```

说明：

- `Start-ScheduledTask` 会比 WSL 内部 `start-supervisor-api-staging.sh` 更早返回
- 因此冷启动后第一下 `status --check` 可能只是任务尚未完全拉起；canonical 操作是轮询到 green
- 如果旧的 dev-backed runtime 还在运行，`start-supervisor-api-staging.sh` 会直接 fail-fast，要求先停掉
  legacy runtime，再启动 canonical runtime

## 日志与轮转

日志目录：

- `.tmp/supervisor-api-staging/logs/otel-collector.log`
- `.tmp/supervisor-api-staging/logs/supervisor-api.log`
- `.tmp/supervisor-api-staging/logs/supervisor-agent-worker.log`
- `.tmp/supervisor-api-staging/logs/cloudflared.log`

轮转规则：

- 每次执行 `start-supervisor-api-staging.sh` 时都会检查日志大小
- 单文件超过 `20 MiB` 时做 copy-truncate 轮转
- 最多保留 `5` 份历史：`.1` 到 `.5`

## 故障分流

`status --check` 报 `supervisor-api compose project is not fully running`

- 先看：
  - `.tmp/supervisor-api-staging/logs/supervisor-api.log`
  - `.tmp/supervisor-api-staging/logs/supervisor-agent-worker.log`
- 如果 `start-supervisor-api-staging.sh` 在 build 前失败，先直接运行：

```bash
infra/local/staging/preflight-supervisor-api-staging.sh
```

- preflight 在 `docker buildx imagetools inspect ...` 或 `docker pull ...`
  阶段失败，通常是 Docker Desktop registry/proxy 配置或到 Docker Hub/GHCR
  的网络不可达；先修 Docker registry 访问，或确认 base images 已经缓存后临时设置
  `SUPERVISOR_API_STAGING_PREFLIGHT_SKIP_REGISTRY=1`
- 再直接执行：

```bash
cd <repo-root>
COMPOSE_PROJECT_NAME=campus-supervisor-api-staging \
SUPERVISOR_API_HOST_PORT=27010 \
docker compose -f infra/local/docker-compose.supervisor-runtime.yml ps
```

`status --check` 报 `local readyz returned HTTP ...`

- 说明 `supervisor-api` 或 `supervisor-agent-worker` 还没达到真实 runtime ready
- 先跑：

```bash
uv run --all-packages python -m scripts.doctor_env supervisor-api --json
```

- 再看 `supervisor-agent-worker.log` 中缺的是 prompt runtime、HTTP pool 还是 worker runtime

真实 chat smoke 返回 `supervisor_unavailable`，且 `supervisor-agent-worker.log` 中出现
`QDRANT_URL is required`

- 说明 transport ready，但 query runtime env 没有进入 Docker runtime
- 先确认容器里变量存在：

```bash
docker exec campus-supervisor-api-staging-supervisor-agent-worker-1 \
  sh -lc 'for k in QDRANT_URL DOCUMENT_REGISTRY_DATABASE_URL \
  EMBEDDING_MODEL; do \
  eval v=\${$k:-}; [ -n "$v" ] && echo "$k=set" || echo "$k=unset"; done'
```

execution audit 不出现在 panel 审计时间线

- 先看 `supervisor-api` 的 `/readyz` 中 `execution_audit_runtime`
- 再看 `/metrics`：

```bash
curl -sS http://127.0.0.1:27010/metrics | grep execution_audit
```

- staging lifecycle 会优先读取显式 `SUPERVISOR_API_EXECUTION_AUDIT_*`
  变量；未显式配置时，会从 `SUPERVISOR_API_STAGING_APP_API_BASE_URL` 与
  `APP_API_INTERNAL_SHARED_SECRET` 派生 internal ingest URL 和 shared secret
- 如果 emitted 增加但 panel 未出现，检查 `app-api` scheduled projector drain；
  internal ingest 成功时也会触发 request-scoped drain，cron 只承担周期性一致性检查

- 如果变量缺失，重新执行：

```bash
infra/local/staging/stop-supervisor-api-staging.sh
infra/local/staging/start-supervisor-api-staging.sh
```

`status --check` 报 `public readyz returned HTTP ...`

- 优先判断 named tunnel connector 是否掉线
- 用 `cloudflared.log` 确认最近一次 connector 注册是否成功

`status --check` 报 `app-api readyz ...`

- 说明本地 supervisor-api runtime 可能健康，但 shared staging `app-api` 自身或它到 supervisor 的依赖不健康
- 直接检查：

```bash
curl --noproxy '*' -sS -i https://campus-api-staging.ayafeed.com/readyz
```

- 如果只有 `supervisorApi` 失败，先回到这份 runbook 的冷启动恢复流程

## Recovery Boundary

当前 active recovery path 是重启 `supervisor-api + supervisor-agent-worker` 双容器 runtime。
仓库不再维护 dev-backed Python public ingress fallback。

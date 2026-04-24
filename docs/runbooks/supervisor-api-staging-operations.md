---
doc_type: runbook
status: active
created: 2026-04-24
updated: 2026-04-24
---
# Supervisor API Staging Operations

## 文档边界

这份 runbook 只回答当前 canonical staging execution upstream 的长期运维真相：

- 当前 repo-owned staging execution runtime 是 `supervisor-api + supervisor-core-worker`
  双容器
- `exec-staging.ayafeed.com` 继续通过 named tunnel 指回这台主机上的本地
  `supervisor-api` runtime

它不覆盖 browser smoke 证据采集；那部分统一看
`supervisor-api-staging-smoke-runbook.md`。

## 当前真相

- `apps/supervisor-api` 的前向 deploy substrate 已冻结为 Docker-first internal execution
  service
- 当前 repo-owned staging execution runtime：
  - `infra/local/docker-compose.supervisor-runtime.yml`
  - `supervisor-api`
    - `trusted-worker`
    - `127.0.0.1:27010`
    - `/healthz` `/readyz` `/metrics` `/api/v1/answer`
    - bounded in-process admission queue / backpressure / graceful drain
  - `supervisor-core-worker`
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

- `supervisor-api` 与 `supervisor-core-worker` 都在当前 compose project 中运行
- 如果配置了 public execution origin，则 `cloudflared` 进程存在
- 本地 `<http://127.0.0.1:27010/healthz`> 返回 `200`
- 本地 `<http://127.0.0.1:27010/readyz`> 返回 `200`
- 本地 `<http://127.0.0.1:27010/metrics`> 返回 `200`
- `<https://exec-staging.ayafeed.com/readyz`> 返回 `200`
- `<https://campus-api-staging.ayafeed.com/readyz`> 返回 `200`
- `campus-api-staging` 的 `auth`、`database`、`supervisorApi` 都是 `ready`

补充约束：

- `supervisor-api` 默认 admission 参数为 `SUPERVISOR_API_MAX_CONCURRENT_ANSWERS=8`、
  `SUPERVISOR_API_QUEUE_CAPACITY=24`、`SUPERVISOR_API_QUEUE_TIMEOUT_MS=3000`、
  `SUPERVISOR_API_REQUEST_TIMEOUT_MS=45000` 与
  `SUPERVISOR_CORE_WORKER_TIMEOUT_MS=35000`
- 默认 lane budget 为 `rag=6/12/3000ms`、`navigation=2/4/1500ms`、
  `campus_services=2/4/1500ms`、`notice=2/4/1500ms`、`default=1/2/1500ms`；
  三元组含义为 `max_concurrent / queue_capacity / queue_timeout`
- `SUPERVISOR_API_OTEL_ENABLED=false` 是本地 staging 默认；开启后必须同时配置
  `SUPERVISOR_API_OTEL_EXPORTER_OTLP_ENDPOINT`，否则 `/readyz` 会标记
  `telemetry_runtime.exporter_configured=false`
- 如果设置了 `SUPERVISOR_API_METRICS_BEARER_TOKEN`，`status-supervisor-api-staging.sh`
  会用该 token 拉取本地 `/metrics`；不应把 raw token 写入日志
- `/readyz` 不因瞬时 `active_answers == max_concurrent_answers` 直接 degraded；只有
  admission queue 已不可接收、runtime draining 或 bridge 不健康时才视为 execution
  runtime 不 ready
- `supervisor-core-worker` 必须同时拿到 query runtime env，包括 `QDRANT_URL`、
  `QDRANT_API_KEY`、`QDRANT_TIMEOUT_SECONDS`、`DOCUMENT_REGISTRY_DATABASE_URL` 或
  `CAMPUS_SHARED_POSTGRES_URL`、`EMBEDDING_*` 与 `SPARSE_*`
- `infra/local/staging/start-supervisor-api-staging.sh` 会从 repo env 与 `apps/app-api/.dev.vars`
  导入这些变量，再通过 `infra/local/docker-compose.supervisor-runtime.yml` 注入容器
- 如果 registry Postgres URL 指向 `127.0.0.1` 或 `localhost`，启动脚本会为 Docker
  orchestrator 改写成 `host.docker.internal`；compose 通过 `host-gateway` 解析回宿主机

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
  fallback runtime，再启动 canonical runtime

## 日志与轮转

日志目录：

- `.tmp/supervisor-api-staging/logs/supervisor-api.log`
- `.tmp/supervisor-api-staging/logs/supervisor-core-worker.log`
- `.tmp/supervisor-api-staging/logs/cloudflared.log`

轮转规则：

- 每次执行 `start-supervisor-api-staging.sh` 时都会检查日志大小
- 单文件超过 `20 MiB` 时做 copy-truncate 轮转
- 最多保留 `5` 份历史：`.1` 到 `.5`

## 故障分流

`status --check` 报 `supervisor-api compose project is not fully running`

- 先看：
  - `.tmp/supervisor-api-staging/logs/supervisor-api.log`
  - `.tmp/supervisor-api-staging/logs/supervisor-core-worker.log`
- 再直接执行：

```bash
cd <repo-root>
COMPOSE_PROJECT_NAME=campus-supervisor-api-staging \
SUPERVISOR_API_HOST_PORT=27010 \
docker compose -f infra/local/docker-compose.supervisor-runtime.yml ps
```

`status --check` 报 `local readyz returned HTTP ...`

- 说明 `supervisor-api` 或 `supervisor-core-worker` 还没达到真实 runtime ready
- 先跑：

```bash
uv run --all-packages python -m scripts.doctor_env supervisor-api --json
```

- 再看 `supervisor-core-worker.log` 中缺的是 prompt/runtime 还是 audit/runtime

真实 chat smoke 返回 `supervisor_unavailable`，且 `supervisor-core-worker.log` 中出现
`QDRANT_URL is required`

- 说明 transport ready，但 query runtime env 没有进入 Docker runtime
- 先确认容器里变量存在：

```bash
docker exec campus-supervisor-api-staging-supervisor-core-worker-1 \
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
  internal ingest 成功时也会触发 request-scoped drain，cron 是兜底

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

当前 active recovery path 是重启 `supervisor-api + supervisor-core-worker` 双容器 runtime。
仓库不再维护 dev-backed Python public ingress fallback。

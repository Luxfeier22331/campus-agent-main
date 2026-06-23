---
doc_type: runbook
truth_scope: ops
owner_boundary: docs/runbooks
status: active
created: 2026-06-13
updated: 2026-06-13
---

# Execution Control Staging Daily Operations And Recovery

<!-- markdownlint-disable MD013 -->

Split from the former mega-doc during documentation SoT cleanup. This file
owns this section group; the original path remains the stable index.

## 日常健康检查

人类可读状态：

```bash
infra/local/staging/status-execution-control-staging.sh
```

严格健康检查：

```bash
infra/local/staging/status-execution-control-staging.sh --check
```

`--check` 通过标准：

- `otel-collector`、`execution-control`、`workflow-worker`、
  `activity-worker-context`、`agent-runtime`、`activity-worker-agent`、
  `activity-worker-knowledge-plan`、`activity-worker-knowledge-retrieval`、
  `activity-worker-knowledge-synthesis`、
  `activity-worker-campus-services`、`activity-worker-notice`、
  `activity-worker-navigation`、`activity-worker-finalization`、
  `temporal` 都在当前 compose project 中运行
- 本地 `<http://127.0.0.1:27051/healthz`> 返回 `200`
- 本地 `<http://127.0.0.1:27051/readyz`> 带 `x-worker-origin-auth` 返回 `200`
  且 payload 明确报告：
  - `run_projection_store.configured=true`
  - `run_projection_store.healthy=true`
  - `temporal_runtime.configured=true`
  - `temporal_runtime.healthy=true`
  - `temporal_runtime.namespace=campus-agent-staging`
  - `temporal_runtime.task_queue=campus-agent.workflow`
  - `rag_runtime.lookup_healthy=true`
  - `rag_runtime.synthesis_healthy=true`
  - `prompt_config_gate.admitted=true`
- 本地 `<http://127.0.0.1:27051/metrics`> 带 bearer token 返回 `200`
- machine ingress 未带 Access service token 时被 Cloudflare Access 拒绝
- machine ingress 带 Access service token 与 `x-worker-origin-auth` 时返回
  authenticated `/readyz 200`
- `<https://api-staging.mucwiki-edge.link/readyz`> 返回 `200`
- `api-staging` 的 `auth`、`database`、`executionControl` 与 `executionRuntime`
  都是 `ready`

当前 strict check 证明的是 Temporal execution plane + projection store + split
worker process readiness；它不等于 worker autoscaler proof 已完成。上线证据需要另行
通过 `infra/local/staging/run-execution-control-ops-proof.sh` 记录一次性
sampler/autoscaler proof 与 step trajectory projection。Temporal 通用运维证据要求见
`temporal-self-host-operations.md`。

补充约束：

- `execution-control` 默认 admission、request timeout、lane budget 与 worker
  profile 来自 `/etc/campus-agent/runtime-profile.staging.json`
- retired Python worker env 与 retired bridge env 不得出现在 active staging
  runtime env；出现时 deploy/start preflight fail closed
- 默认 lane budget 为 `rag=6/12/3000ms`、`navigation=2/4/1500ms`、
  `campus_services=2/4/1500ms`、`notice=2/4/1500ms`、`default=1/2/1500ms`；
  三元组含义为 `max_concurrent / queue_capacity / queue_timeout`
- durable lane budget 的目标语义是 PG-backed `max_active_leases`、queued run / queued step
  budget 与 lease timeout。上述 process-local 三元组只保留为当前 staging process protection，
  不得作为 worker autoscaling 或 production queue truth。
- staging 默认通过 runtime profile 启用 OTel traces / metrics
- staging runtime profile 同时启用 Temporal Go SDK tracing interceptor，workflow / activity
  worker span 必须随 online answer trace 发往本地 Collector
- `execution-control` traces / metrics 都应发往本地 `otel-collector`
- OTel attribute allowlist、forbidden fields 与 sink ownership 以
  `docs/reference/runtime-otel-telemetry-taxonomy.md` 为准；staging 不应把 raw prompt、
  raw query、raw answer、token、cookie、auth material 或正文片段发往 Sentry/Axiom
- Collector / Sentry / Axiom fan-out 操作以
  `docs/runbooks/runtime-otel-collector-pipeline.md` 为准；runtime 只把 sanitized OTLP
  发给 Collector，vendor endpoint/header/dataset 由部署 secret 注入
- `execution-control` 会从入口请求提取 `traceparent` / `baggage`；为兼容当前
  `app-api` 链路，也会把有效的 `sentry-trace` 转成标准 `traceparent`。向
  Temporal activity projection 只传播 sanitized trace/run/step context
- staging profile 必须设置 `EXECUTION_CONTROL_METRICS_BEARER_TOKEN`；
  `status-execution-control-staging.sh` 会用该 token 拉取本地 `/metrics`，且不应把
  raw token 写入日志
- staging lifecycle 会投影 `DEPLOYMENT_ENVIRONMENT=staging`，并把
  `EXECUTION_CONTROL_RUNTIME_RELEASE` 派生为 `execution-control@<deploy git sha>`。
  execution-control runtime profile 启用 OTel 时，缺少该 release identity 必须
  fail closed；canonical staging 不要求开发者在 `runtime.env` 手写它。
- staging profile 下，execution-control full `/readyz` 是 trusted machine probe；
  local lifecycle script 使用 `API_WORKER_SHARED_SECRET` 对本地 `/readyz` 加
  `x-worker-origin-auth`。release QA 不把 execution-control host 列为 public surface；
  product smoke 通过 `api-staging /readyz` 证明 app-api 已用 Access service token 和内部
  shared secret 完成 execution-control readiness probe
- `/readyz` 不因瞬时 `active_answers == max_concurrent_answers` 直接 degraded；只有
  admission queue 已不可接收、runtime draining、Temporal / projection / RAG runtime
  不健康时才视为 execution runtime 不 ready
- `infra/local/staging/start-execution-control-staging.sh` 只读取
  `EXECUTION_CONTROL_STAGING_ENV_FILE` 指向的 ops-owned runtime env；默认路径是
  `/srv/docker/campus-agent/staging/env/runtime.env`。query/runtime 数据面只接受该文件中的
  `STAGING_INGESTION_*`，再投影成
  Compose 里的 `CAMPUS_SHARED_POSTGRES_URL`、`DOCUMENT_REGISTRY_DATABASE_URL`、
  `RAW_ASSET_REGISTRY_DATABASE_URL`、`CAMPUS_SHARED_POSTGRES_OPERATOR_URL`、
  `DOCUMENT_REGISTRY_OPERATOR_DATABASE_URL`、`RAW_ASSET_REGISTRY_OPERATOR_DATABASE_URL`、
  `OBJECT_STORE_*`、`QDRANT_*`、`EMBEDDING_*` 与 `SPARSE_*`
- `STAGING_INGESTION_SHARED_POSTGRES_URL`、`STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL`、
  `STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL` 与
  `STAGING_INGESTION_OBJECT_STORE_ENDPOINT` 允许在 `nc-arm-6c` 同机自托管部署中填写
  `127.0.0.1` / `localhost`。这些值只表示 host-side 运维 / preflight URL；lifecycle
  脚本会在 Docker compose 环境中分别投影成 `postgres:5432` 与 `minio:9000`。
  repo-owned local Postgres 是 single-node dependency，所有本地 Postgres DSN 必须使用同一
  database/user/password/port；repo-owned local MinIO 是 single-node dependency，
  shared 与 derived credential 同时配置时必须是同一组 credential。
- self-host Qdrant 在 canonical Docker runtime 中默认投影为 `http://qdrant:6333`；
  `STAGING_INGESTION_QDRANT_URL` 只在外接 / 非 canonical endpoint 时填写。跨
  substrate 或公网入口必须使用 HTTPS + CA，compose 内部 service DNS 可使用 HTTP。
- query runtime 使用 generated `QDRANT_READ_ONLY_API_KEY` 投影出的
  `QDRANT_QUERY_API_KEY`；ingestion、snapshot backup 和 restore 运维使用 admin key。
- sparse retrieval / indexing 使用 self-hosted Qdrant server-side BM25 inference：
  Python runtime 发送 `qdrant/bm25` `Document`，不部署 Qdrant Cloud，不部署独立 BM25
  服务，也不在生产路径使用本地 FastEmbed。
- staging runtime 启动前会确保 `campus-agent-data-plane` Docker network 存在；
  启动后通过 execution-control `/readyz` 的 `rag_runtime.lookup_healthy`
  证明 Go knowledge worker 能访问 authenticated Qdrant data-plane。该检查失败时
  直接 fail closed。
- staging runtime 启动前必须证明 ingestion-control data-plane readiness。
  registry rename、release readiness 与 alias publish 不再通过 Python collection
  worker probe 执行；这些检查必须表现为 ingestion-control task closeout、operator
  projection 或 execution-control `/readyz` 的 explicit failure。
  如果
  `regulations/student_handbook` 或 `regulations/institutional_regulations` 仍残留在
  `document_registry` / `raw_asset_registry` 的 `collection` 列或 `record.collection`，
  不要在 retrieval/read path 增加兼容 alias；通过显式 migration 或 admitted
  cleanup task 修正数据，再启动 staging runtime。

- RAG runtime readiness 由 execution-control `/readyz` 与 ingestion-control
  release/operator projection 共同证明，并显式检查
  `regulations/student_rules`、`regulations/institutional_rules` 与
  `curriculum/curriculum_plan`。
  任一 core query-serving surface 不 ready 时 staging 启动必须 fail closed。典型 blocker：
  - `qdrant_endpoint_not_ready`：Qdrant REST endpoint 不可达，先修 runtime env 与
    data-plane network。
  - `alias_not_published`：对应 serving alias 未发布，先执行 release/publish task。
  - `stale_alias`：alias 指向旧 physical collection，先切换到 latest accepted release。
  - `release_metadata_guard_failed`：query runtime 的 embedding/sparse/profile 设置与
    index release metadata 不一致，先修 env 或重新发布 index release。
- 当 compose project 尚未运行、启动脚本需要 `docker compose up -d --build` 时，
  `start-execution-control-staging.sh` 会先执行
  `infra/local/staging/preflight-execution-control-staging.sh`
- preflight 会通过 `docker version --format '{{.Server.Version}}'` 检查 Docker daemon，
  并检查 Docker Compose v2、compose 文件存在性，以及当前 staging Dockerfile 依赖的 base image
  registry 可达性：
  - `golang:1.26.2-bookworm`
  - `debian:bookworm-slim`
  - `python:3.12-slim-bookworm`
  - `ghcr.io/astral-sh/uv:0.8.22-python3.12-bookworm-slim`
- registry preflight 默认使用 `docker buildx imagetools inspect`；设置
  `EXECUTION_CONTROL_STAGING_PREFLIGHT_PULL=1` 时改用 `docker pull`
- Docker daemon / Compose 基础检查默认 `10s` 超时，可用
  `EXECUTION_CONTROL_STAGING_PREFLIGHT_DOCKER_TIMEOUT_SECONDS` 调整；registry 检查默认
  `30s` 超时，可用 `EXECUTION_CONTROL_STAGING_PREFLIGHT_REGISTRY_TIMEOUT_SECONDS` 调整
- 如果 staging host 已经预拉取 base image 且处于受控离线/代理故障窗口，可设置
  `EXECUTION_CONTROL_STAGING_PREFLIGHT_SKIP_REGISTRY=1` 跳过 registry 检查；这只应作为本机
  环境绕过，不表示 registry 依赖已恢复

## 冷启动恢复

当前 canonical 冷启动恢复流程：

```bash
cd /srv/apps/campus-agent
infra/local/staging/stop-execution-control-staging.sh
infra/local/staging/start-execution-control-staging.sh
until infra/local/staging/status-execution-control-staging.sh --check; do \
  sleep 2; done
```

说明：

- origin reverse proxy 和 Docker Compose runtime 是两个独立常驻单元
- `status --check` 要同时证明本地 runtime、machine ingress contract 和 shared `app-api`
  readiness
- 如果旧的 dev-backed runtime 还在运行，必须先停掉 legacy runtime，再启动 canonical
  runtime

## 日志与轮转

日志目录：

- `.tmp/execution-control-staging/logs/otel-collector.log`
- `.tmp/execution-control-staging/logs/otel-collector.recent.log`
- `.tmp/execution-control-staging/logs/execution-control.log`
- `.tmp/execution-control-staging/logs/workflow-worker.log`
- `.tmp/execution-control-staging/logs/activity-worker-context.log`
- `.tmp/execution-control-staging/logs/agent-runtime.log`
- `.tmp/execution-control-staging/logs/activity-worker-agent.log`
- `.tmp/execution-control-staging/logs/activity-worker-knowledge-plan.log`
- `.tmp/execution-control-staging/logs/activity-worker-knowledge-retrieval.log`
- `.tmp/execution-control-staging/logs/activity-worker-knowledge-synthesis.log`
- `.tmp/execution-control-staging/logs/activity-worker-campus-services.log`
- `.tmp/execution-control-staging/logs/activity-worker-notice.log`
- `.tmp/execution-control-staging/logs/activity-worker-navigation.log`
- `.tmp/execution-control-staging/logs/activity-worker-finalization.log`
- ops proof 输出应写入本轮 evidence 目录，不作为常驻日志文件依赖

轮转规则：

- 每次执行 `start-execution-control-staging.sh` 时都会检查日志大小
- 单文件超过 `20 MiB` 时做 copy-truncate 轮转
- 最多保留 `5` 份历史：`.1` 到 `.5`
- `otel-collector.log` 保留全量容器日志用于历史排障；`status --check` 的
  exporter failure gate 只读取 `otel-collector.recent.log`，即本次检查窗口内的
  collector 日志。历史上已经修复的 exporter 401/403 不应永久阻塞当前 readiness。

## 故障分流

`status --check` 报 `execution-control compose project is not fully running`

- 先看：
  - `.tmp/execution-control-staging/logs/execution-control.log`
  - `.tmp/execution-control-staging/logs/workflow-worker.log`
  - `.tmp/execution-control-staging/logs/activity-worker-context.log`
  - `.tmp/execution-control-staging/logs/agent-runtime.log`
  - `.tmp/execution-control-staging/logs/activity-worker-agent.log`
  - `.tmp/execution-control-staging/logs/activity-worker-knowledge-plan.log`
  - `.tmp/execution-control-staging/logs/activity-worker-knowledge-retrieval.log`
  - `.tmp/execution-control-staging/logs/activity-worker-knowledge-synthesis.log`
  - `.tmp/execution-control-staging/logs/activity-worker-campus-services.log`
  - `.tmp/execution-control-staging/logs/activity-worker-notice.log`
  - `.tmp/execution-control-staging/logs/activity-worker-navigation.log`
  - `.tmp/execution-control-staging/logs/activity-worker-finalization.log`
- 如果 `start-execution-control-staging.sh` 在 build 前失败，先直接运行：

```bash
infra/local/staging/preflight-execution-control-staging.sh
```

- preflight 在 `docker buildx imagetools inspect ...` 或 `docker pull ...`
  阶段失败，通常是 Docker Desktop registry/proxy 配置或到 Docker Hub/GHCR
  的网络不可达；先修 Docker registry 访问，或确认 base images 已经缓存后临时设置
  `EXECUTION_CONTROL_STAGING_PREFLIGHT_SKIP_REGISTRY=1`
- 再直接执行：

```bash
cd <repo-root>
COMPOSE_PROJECT_NAME=campus-execution-control-staging \
EXECUTION_CONTROL_HOST_PORT=27051 \
docker compose -f infra/local/docker-compose.execution-control-runtime.yml ps
```

`status --check` 报 `local readyz returned HTTP ...`

- 说明 `execution-control`、Temporal poller、run projection store、RAG runtime 或
  prompt pricing gate 还没达到真实 runtime ready
- 先跑：

```bash
source infra/local/staging/execution-control-staging-common.sh
execution_control_staging_load_env >/dev/null
execution_control_staging_uv_run --all-packages \
  python -m scripts.doctor_env execution-control --json
```

- 再看 execution-control `/readyz` 中 `temporal_runtime`、`run_projection_store`、
  `rag_runtime` 与 `prompt_config_gate` 的具体 failure reason

```bash
curl -sS -H "x-worker-origin-auth: ${API_WORKER_SHARED_SECRET}" \
  http://127.0.0.1:27051/readyz
```

execution audit 不出现在 panel 审计时间线

- 先看 `execution-control` 的 `/readyz` 中 `execution_audit_runtime`
- 再看 `/metrics`：

```bash
curl -sS http://127.0.0.1:27051/metrics | grep execution_audit
```

- staging lifecycle 会优先读取显式 `EXECUTION_CONTROL_EXECUTION_AUDIT_URL` 与
  `EXECUTION_CONTROL_EXECUTION_AUDIT_SHARED_SECRET`；未显式配置时，会从
  `EXECUTION_CONTROL_STAGING_APP_API_BASE_URL` 与 `APP_API_INTERNAL_SHARED_SECRET`
  派生 internal ingest URL 和 shared secret。execution audit 是否启用与 timeout
  由 runtime profile 管理。
- 如果 emitted 增加但 panel 未出现，优先检查 request-scoped drain evidence；
  `app-api` scheduled projector drain 默认关闭，只在显式 `APP_API_*_SWEEPER_ENABLED=true`
  的周期性一致性检查 lane 中运行

- 如果变量缺失，重新执行：

```bash
infra/local/staging/stop-execution-control-staging.sh
infra/local/staging/start-execution-control-staging.sh
```

`status --check` 报 machine ingress request 被拒绝或 origin 不可达

- 先确认 Cloudflare DNS record 指向当前 staging VM，且 proxied 状态开启
- 再确认 Access application 绑定
  `execution-control-staging.mucwiki-edge.link`，policy 只允许 service token
- VM 上确认 Caddy/Nginx 正在监听 `443`，并只反代到 `127.0.0.1:27051`
- 如果未带 Access token 请求返回 `200`，这是 Access policy blocker，不能继续标绿
- 如果带 Access token 但缺 `x-worker-origin-auth` 返回 `200`，这是 execution-control auth
  blocker，不能继续标绿

`status --check` 报 `app-api readyz ...`

- 说明本地 execution-control runtime 可能健康，但 shared staging `app-api`
  自身或它到 supervisor 的依赖不健康
- 直接检查：

```bash
curl --noproxy '*' -sS -i https://api-staging.mucwiki-edge.link/readyz
```

- 如果只有 `executionControl` 或 `executionRuntime` 失败，先确认 app-api staging
  已配置 `EXECUTION_CONTROL_ACCESS_CLIENT_ID`、
  `EXECUTION_CONTROL_ACCESS_CLIENT_SECRET` 与 `EXECUTION_CONTROL_SHARED_SECRET`，
  再回到这份 runbook 的冷启动恢复流程

## Recovery Boundary

当前 active recovery path 是重启 execution-control compose runtime。
仓库不再维护 dev-backed Python public ingress fallback。

## Staging RAG Release Manifest Recovery

Use this path only when all of the following are true:

1. self-hosted Qdrant is healthy;
1. the serving alias points at the intended physical collection;
1. a native snapshot bundle exists under
   `/srv/backups/campus-agent/qdrant-snapshots`;
1. runtime readiness is blocked because the derived object store lacks the
   matching `index-release.json`.

Reconstruction is no longer an ingestion-worker Python command. Admit an
explicit recovery task through ingestion-control with the backup-root and
target manifest keys as task input, then verify readiness:

```bash
infra/local/staging/status-execution-control-staging.sh --check
```

Do not use this command to bypass a failed ingestion release. If Qdrant payload
metadata or the native snapshot sidecar is inconsistent, rebuild or restore the
affected release instead.
